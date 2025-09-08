# worker.py
import os, json, time
from typing import Optional, Dict, Any, List
import redis
from rq import Queue, Worker
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from psycopg_pool import PoolTimeout
from psycopg import OperationalError, InterfaceError
from redis.exceptions import RedisError
from app.db import pool  # shared connection pool

# -------- Config / helpers --------
def _normalize_redis_url(value: str | None) -> str:
    v = (value or "").strip()
    if not v:
        return "redis://redis:6379/0"
    if "://" not in v:
        v = f"redis://{v}"
    return v

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8080").rstrip("/")
REDIS_URL    = _normalize_redis_url(os.getenv("REDIS_URL"))
MOCK_META    = os.getenv("MOCK_META", "1") not in ("0", "false", "False")
META_GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v19.0")
WORKER_ID    = os.getenv("HOSTNAME") or "worker"

# HTTP session with retry for transient errors
session = requests.Session()
session.headers.update({"User-Agent": "scheduler-backend/1.0"})
session.mount(
    "https://",
    HTTPAdapter(
        max_retries=Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET", "POST"]),
        )
    ),
)

RETRYABLE_HTTP = {429, 500, 502, 503, 504}

def _abs_media_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return f"{APP_BASE_URL}{url}"
    return f"{APP_BASE_URL}/{url}"

# -------- DB helpers --------

def _load_account(account_id: int) -> Optional[Dict[str, Any]]:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ig_user_id, COALESCE(access_token,'') FROM accounts WHERE id=%s AND active=true",
                (account_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {"ig_user_id": row[0], "access_token": row[1]}

def _heartbeat(post_id: int):
    """Refresh lock to avoid the reaper unlocking long network jobs."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE posts SET locked_at=now(), locked_by=%s WHERE id=%s", (WORKER_ID, post_id))
        conn.commit()
        
        
def _load_post_for_publish(post_id: int) -> Optional[Dict[str, Any]]:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE posts
                   SET status='publishing',
                       locked_at=now(),
                       locked_by=%s
                 WHERE id=%s AND status='queued'
                 RETURNING id, account_id, post_type, media_url, COALESCE(caption,''), COALESCE(retry_count,0)
            """, (WORKER_ID, post_id))
            row = cur.fetchone()
        conn.commit()
    if not row: return None
    return {
        "id": row[0],
        "account_id": row[1],
        "post_type": row[2],
        "media_url": row[3],
        "caption": row[4],
        "retry_count": int(row[5]),
    }

def _save_publish_success(post_id: int, result: Dict[str, Any]):
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE posts
                   SET status='published',
                       publish_result=%s,
                       retry_count=0,
                       error_code=NULL,
                       locked_at=NULL,
                       locked_by=NULL
                 WHERE id=%s
                """,
                (json.dumps(result), post_id),
            )
        conn.commit()

RETRY_DELAY_SEC = int(os.getenv("RETRY_DELAY_SEC", "600"))  # 10 min
PAUSE_ON_CONSEC_FAILS = int(os.getenv("PAUSE_ON_CONSEC_FAILS", "3"))

def _backoff_seconds(_retry_count: int) -> int:
    # fixed 10 minutes, regardless of attempt number
    return RETRY_DELAY_SEC


def _maybe_auto_pause(account_id: int):
    """
    If the last N (=PAUSE_ON_CONSEC_FAILS) posts for this account all ended in
    status='failed' AND each has retry_count >= 2, pause the account and fail any
    remaining scheduled posts so they show red immediately.
    """
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, retry_count, status, error_code
                  FROM posts
                 WHERE account_id=%s
                 ORDER BY updated_at DESC
                 LIMIT %s
                """,
                (account_id, PAUSE_ON_CONSEC_FAILS),
            )
            rows = cur.fetchall()

            if len(rows) < PAUSE_ON_CONSEC_FAILS:
                return

            all_failed_twice = all(
                (r[2] == "failed") and (int(r[1] or 0) >= 2)
                for r in rows
            )
            if not all_failed_twice:
                return

            # Pause the account
            cur.execute("UPDATE accounts SET active=false WHERE id=%s", (account_id,))

            # Fail all pending scheduled posts so they render red immediately
            cur.execute(
                """
                UPDATE posts
                   SET status='failed',
                       error_code='account_paused',
                       publish_result = COALESCE(publish_result,'{}'::jsonb) || '{"paused":true}'::jsonb,
                       updated_at=now()
                 WHERE account_id=%s
                   AND status='scheduled'
                """,
                (account_id,),
            )
        conn.commit()
        
def _fail_or_retry(post_id: int, account_id: int, code: str, payload: Dict[str, Any], retry_count: int):
    """
    Exactly one retry 10 minutes later, then mark failed.
    """
    should_retry = retry_count < 1  # allow one retry only
    next_secs = _backoff_seconds(retry_count + 1)

    with pool.connection() as conn:
        with conn.cursor() as cur:
            if should_retry:
                cur.execute(
                    """
                    UPDATE posts
                       SET status='scheduled',
                           retry_count=retry_count+1,
                           next_attempt_at = now() + make_interval(secs => %s),
                           error_code=%s,
                           publish_result = COALESCE(publish_result,'{}'::jsonb) || %s::jsonb,
                           locked_at=NULL,
                           locked_by=NULL,
                           updated_at=now()
                     WHERE id=%s
                    """,
                    (next_secs, code[:200], json.dumps(payload), post_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE posts
                       SET status='failed',
                           retry_count=retry_count+1,
                           error_code=%s,
                           publish_result = COALESCE(publish_result,'{}'::jsonb) || %s::jsonb,
                           locked_at=NULL,
                           locked_by=NULL,
                           updated_at=now()
                     WHERE id=%s
                    """,
                    (code[:200], json.dumps(payload), post_id),
                )
        conn.commit()
        if not should_retry:
            _maybe_auto_pause(account_id)



# -------- Meta Graph calls --------
def _graph_publish_photo(ig_user_id, access_token, image_url, caption, *, sess: requests.Session) -> Dict[str, Any]:
    base = f"https://graph.facebook.com/{META_GRAPH_VERSION}"

    # Step 1: create media container
    r1 = sess.post(
        f"{base}/{ig_user_id}/media",
        data={"image_url": image_url, "caption": caption, "access_token": access_token},
        timeout=20,
    )
    r1.raise_for_status()
    data1 = r1.json()
    creation_id = data1.get("id")
    if not creation_id:
        raise RuntimeError(f"no_creation_id: {data1}")

    # Step 2: publish
    r2 = sess.post(
        f"{base}/{ig_user_id}/media_publish",
        data={"creation_id": creation_id, "access_token": access_token},
        timeout=20,
    )
    r2.raise_for_status()
    data2 = r2.json()

    return {"step1": data1, "step2": data2, "image_url": image_url, "caption": caption}

def _graph_publish_reel(
    ig_user_id: str,
    access_token: str,
    video_url: str,
    caption: str,
    share_to_feed: bool,
    *,
    sess: requests.Session
) -> Dict[str, Any]:
    base = f"https://graph.facebook.com/{META_GRAPH_VERSION}"

    # 1) create media container
    r1 = sess.post(
        f"{base}/{ig_user_id}/media",
        data={
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "share_to_feed": "true" if share_to_feed else "false",
            "access_token": access_token,
        },
        timeout=60,
    )
    r1.raise_for_status()
    creation_id = (r1.json() or {}).get("id")
    if not creation_id:
        raise RuntimeError(f"no_creation_id:{r1.text}")

    # 2) wait for IG to finish processing the video
    _wait_container_ready(creation_id, access_token, sess=sess)

    # 3) publish
    r2 = sess.post(
        f"{base}/{ig_user_id}/media_publish",
        data={"creation_id": creation_id, "access_token": access_token},
        timeout=60,
    )
    r2.raise_for_status()
    return {
        "step1": r1.json(),
        "step2": r2.json(),
        "video_url": video_url,
        "caption": caption,
        "share_to_feed": share_to_feed,
    }


def _graph_publish_carousel(
    ig_user_id: str,
    access_token: str,
    items: list[str],
    caption: str,
    *,
    sess: requests.Session
) -> Dict[str, Any]:
    base = f"https://graph.facebook.com/{META_GRAPH_VERSION}"

    child_ids: list[str] = []
    for url in items[:10]:
        is_video = url.lower().endswith((".mp4", ".mov", ".m4v"))
        if is_video:
            r = sess.post(
                f"{base}/{ig_user_id}/media",
                data={
                    "media_type": "VIDEO",
                    "video_url": url,
                    "is_carousel_item": "true",
                    "access_token": access_token,
                },
                timeout=60,
            )
            r.raise_for_status()
            cid = (r.json() or {}).get("id")
            if not cid:
                raise RuntimeError(f"no_child_id_for:{url}")
            # wait for child video to finish processing
            _wait_container_ready(cid, access_token, sess=sess)
            child_ids.append(cid)
        else:
            r = sess.post(
                f"{base}/{ig_user_id}/media",
                data={
                    "image_url": url,
                    "is_carousel_item": "true",
                    "access_token": access_token,
                },
                timeout=60,
            )
            r.raise_for_status()
            cid = (r.json() or {}).get("id")
            if not cid:
                raise RuntimeError(f"no_child_id_for:{url}")
            child_ids.append(cid)

    if not child_ids or len(child_ids) < 2:
        raise RuntimeError("carousel_needs_min_2_items")

    # parent container
    r2 = sess.post(
        f"{base}/{ig_user_id}/media",
        data={
            "media_type": "CAROUSEL",
            "children": ",".join(child_ids),
            "caption": caption,
            "access_token": access_token,
        },
        timeout=60,
    )
    r2.raise_for_status()
    creation_id = (r2.json() or {}).get("id")
    if not creation_id:
        raise RuntimeError(f"no_carousel_creation_id:{r2.text}")

    # publish
    r3 = sess.post(
        f"{base}/{ig_user_id}/media_publish",
        data={"creation_id": creation_id, "access_token": access_token},
        timeout=60,
    )
    r3.raise_for_status()

    return {"children": child_ids, "container": r2.json(), "publish": r3.json(), "caption": caption}


def _wait_container_ready(
    creation_id: str,
    access_token: str,
    *,
    sess: requests.Session,
    timeout_s: int = 300,
    poll_s: int = 5,
):
    """Poll the container until IG marks the upload FINISHED, or timeout."""
    base = f"https://graph.facebook.com/{META_GRAPH_VERSION}"
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        r = sess.get(
            f"{base}/{creation_id}",
            params={"fields": "status_code", "access_token": access_token},
            timeout=30,
        )
        r.raise_for_status()
        sc = (r.json() or {}).get("status_code")
        last = sc
        print(f"[IG] container {creation_id} status_code={sc}", flush=True)
        if sc in ("FINISHED", "PUBLISHED"):  # success
            return
        if sc in ("ERROR", "FAILED"):
            raise RuntimeError(f"video_processing_error:{sc}")
        time.sleep(poll_s)
    raise RuntimeError(f"video_processing_timeout:last={last}")




# -------- Job entrypoint --------
def publish_one(post_id: int):
    post: Optional[Dict[str, Any]] = None
    account_id: Optional[int] = None
    retry_ct: int = 0

    try:
        post = _load_post_for_publish(post_id)
        if not post:
            return {"ok": False, "error": "not_found_or_not_queued"}

        image_url = _abs_media_url(post["media_url"])
        caption   = post["caption"]
        retry_ct  = int(post.get("retry_count", 0))
        account_id = int(post["account_id"])

        acc = _load_account(account_id)
        if not acc or not acc.get("access_token"):
            _fail_or_retry(post_id, account_id, "missing_access_token", {"message": "no active account or token"}, retry_ct)
            return {"ok": False, "error": "missing_access_token"}

        _heartbeat(post_id)

        if MOCK_META:
            time.sleep(0.2)
            result = {"mock": True, "at": time.time(), "post_type": (post.get("post_type") or "").lower()}
        else:
            post_type = (post.get("post_type") or "").lower()

            if post_type == "photo":
                # use the precomputed image_url
                result = _graph_publish_photo(
                    str(acc["ig_user_id"]),
                    acc["access_token"],
                    image_url,
                    caption,
                    sess=session,
                )

            elif post_type in ("reel_feed", "reel_only"):
                video_url = _abs_media_url(post["media_url"])
                share = (post_type == "reel_feed")
                result = _graph_publish_reel(
                    str(acc["ig_user_id"]),
                    acc["access_token"],
                    video_url,
                    caption,
                    share_to_feed=share,
                    sess=session,
                )
        
            elif post_type == "carousel":
                # Hard gate V1
                _fail_or_retry(post_id, account_id, "disabled", {"message": "carousels_disabled_v1"}, retry_count=999)
                return {"ok": False, "disabled": True}

        
            else:
                raise RuntimeError(f"unsupported_post_type:{post_type}")
            
        _save_publish_success(post_id, result)
        return {"ok": True, "result": result}



    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        try:
            body = e.response.json() if e.response is not None else {}
        except Exception:
            body = {"text": e.response.text if e.response is not None else ""}
        aid = account_id if account_id is not None else (int(post["account_id"]) if post else 0)
        rc  = retry_ct if post else 0
        _fail_or_retry(post_id, aid, f"http_{status}", body, rc)
        return {"ok": False, "error": f"http_{status}"}

    except (PoolTimeout, OperationalError, InterfaceError) as e:
        aid = account_id if account_id is not None else (int(post["account_id"]) if post else 0)
        rc  = retry_ct if post else 0
        _fail_or_retry(post_id, aid, "db_pool_error", {"message": str(e)}, rc)
        return {"ok": False, "error": "db_pool_error"}

    except (RedisError, requests.ConnectionError, requests.Timeout) as e:
        aid = account_id if account_id is not None else (int(post["account_id"]) if post else 0)
        rc  = retry_ct if post else 0
        _fail_or_retry(post_id, aid, "transient_io", {"message": str(e)}, rc)
        return {"ok": False, "error": "transient_io"}

    except Exception as e:
        aid = account_id if account_id is not None else (int(post["account_id"]) if post else 0)
        rc  = retry_ct if post else 0
        _fail_or_retry(post_id, aid, "exception", {"message": str(e)}, rc)
        return {"ok": False, "error": "exception"}

    finally:
        try:
            if post:
                _heartbeat(post["id"])
        except Exception:
            pass


# -------- Worker bootstrap --------
def run_worker():
    r = redis.from_url(REDIS_URL)
    q = Queue("publish", connection=r)
    worker = Worker([q], connection=r)
    worker.work(with_scheduler=True)

if __name__ == "__main__":
    run_worker()
