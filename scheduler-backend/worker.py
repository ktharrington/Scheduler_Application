import os, json, time
from typing import Optional, Dict, Any
import redis
import requests
from rq import Queue, Worker
from app.db import pool  # use a single connection per critical section

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8080").rstrip("/")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
MOCK_META = os.getenv("MOCK_META", "1") not in ("0", "false", "False")
META_GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v19.0")

# Small helper to ensure absolute URL for media (Meta must fetch it)
def _abs_media_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    # treat as absolute path from FastAPI static /media
    if url.startswith("/"):
        return f"{APP_BASE_URL}{url}"
    # fallback (shouldn't happen with our upload route, but just in case)
    return f"{APP_BASE_URL}/{url}"

def _load_post_for_publish(post_id: int) -> Optional[Dict[str, Any]]:
    """Grab the post row and mark as 'publishing' atomically, using a single connection."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            # Lock the post row so we don't double-publish
            cur.execute(
                """
                SELECT id, account_id, media_url, caption, retry_count
                  FROM posts
                 WHERE id=%s
                 FOR UPDATE
                """,
                (post_id,),
            )
            row = cur.fetchone()
            if not row:
                return None

            post = {
                "id": row[0],
                "account_id": row[1],
                "media_url": row[2],
                "caption": row[3] or "",
                "retry_count": row[4] or 0,
            }

            # Move to 'publishing' and lock
            cur.execute(
                "UPDATE posts SET status='publishing', locked_at=now(), updated_at=now() WHERE id=%s",
                (post_id,),
            )
        conn.commit()
    return post

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
                       updated_at=now()
                 WHERE id=%s
                """,
                (json.dumps(result), post_id),
            )
        conn.commit()

def _save_publish_failure(post_id: int, error_code: str, extra: Optional[Dict[str, Any]] = None):
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE posts
                   SET status='failed',
                       publish_result=COALESCE(publish_result,'{}'::jsonb) || %s::jsonb,
                       retry_count=retry_count+1,
                       error_code=%s,
                       locked_at=NULL,
                       updated_at=now()
                 WHERE id=%s
                """,
                (json.dumps(extra or {}), error_code[:200], post_id),
            )
        conn.commit()

def _graph_publish_photo(ig_user_id: str, access_token: str, image_url: str, caption: str) -> Dict[str, Any]:
    """Minimal 2-step photo publish: /media then /media_publish."""
    base = f"https://graph.facebook.com/{META_GRAPH_VERSION}"
    s = requests.Session()
    s.headers.update({"User-Agent": "scheduler-backend/1.0"})
    # Step 1: create media container
    r1 = s.post(
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
    r2 = s.post(
        f"{base}/{ig_user_id}/media_publish",
        data={"creation_id": creation_id, "access_token": access_token},
        timeout=20,
    )
    r2.raise_for_status()
    data2 = r2.json()
    return {"step1": data1, "step2": data2, "image_url": image_url, "caption": caption}

def publish_one(post_id: int):
    """
    Worker entrypoint. Never hold a DB connection while calling external APIs:
      - load & mark row => release connection
      - network call
      - save result
    """
    post = _load_post_for_publish(post_id)
    if not post:
        return {"ok": False, "error": "not_found"}

    # Derive absolute image url
    image_url = _abs_media_url(post["media_url"])
    caption = post["caption"]

    # Fetch account AFTER releasing connection
    acc = _load_account(post["account_id"])
    if not acc:
        _save_publish_failure(post_id, "no_active_account", {"image_url": image_url})
        return {"ok": False, "error": "no_active_account"}

    try:
        if MOCK_META:
            # Simulate a publish quickly and succeed
            time.sleep(0.2)
            result = {"mock": True, "caption": caption, "image_url": image_url}
        else:
            if not acc["access_token"]:
                raise RuntimeError("missing_access_token")
            result = _graph_publish_photo(str(acc["ig_user_id"]), acc["access_token"], image_url, caption)

        _save_publish_success(post_id, result)
        return {"ok": True, "result": result}

    except requests.HTTPError as e:
        # Meta responded with an error
        try:
            payload = e.response.json()
        except Exception:
            payload = {"text": e.response.text if e.response is not None else ""}
        _save_publish_failure(post_id, f"http_{e.response.status_code if e.response else 'NA'}", payload)
        return {"ok": False, "error": "http_error"}

    except Exception as e:
        _save_publish_failure(post_id, "exception", {"message": str(e)})
        return {"ok": False, "error": "exception", "message": str(e)}

def run_worker():
    r = redis.from_url(REDIS_URL)
    q = Queue("publish", connection=r)
    worker = Worker([q], connection=r)
    worker.work(with_scheduler=True)

if __name__ == "__main__":
    run_worker()
