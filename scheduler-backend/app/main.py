import os
import io
import csv
import json
import uuid
import math
import hashlib
import logging
import re
import mimetypes
import random
from datetime import datetime, date, time, timedelta, timezone
from typing import Literal, Optional, List, Dict, Any, Tuple
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi import APIRouter, Header
from fastapi.responses import Response
router = APIRouter()
from pydantic import BaseModel, Field, ValidationError
from zoneinfo import ZoneInfo
from psycopg import sql
from app.db import query, execute, pool
from app import s3util
import ssl, certifi
from urllib.parse import urlparse, unquote
from urllib.request import Request as URLReq, urlopen
from urllib.error import HTTPError, URLError
from starlette.concurrency import run_in_threadpool



# ---------- Config ----------
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8080")
MEDIA_ROOT = os.getenv("MEDIA_ROOT", "./media")
MEDIA_URL_PATH = os.getenv("MEDIA_URL_PATH", "/media")
MIN_SPACING_MINUTES = int(os.getenv("MIN_SPACING_MINUTES", "15"))

# Media backend: 'local' (default) or 's3'
MEDIA_BACKEND = os.getenv("STORAGE_BACKEND", os.getenv("MEDIA_BACKEND", "local")).lower()

STAR_CAPTION_RE = re.compile(r"\*{5}([^*]{1,200})\*{5}")


# S3 config (used when MEDIA_BACKEND == 's3')
S3_BUCKET = os.getenv("S3_BUCKET", "")
S3_REGION = os.getenv("S3_REGION", "")
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "")  # optional (MinIO, custom)
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL", "").rstrip("/")  # optional CDN/domain
S3_ACL = os.getenv("S3_ACL", "")  # e.g., 'public-read' or empty to omit
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID", "")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY", "")

USE_MOCK_META = os.getenv("MOCK_META", "1") == "1"

VIDEO_EXTS = (".mp4", ".mov", ".m4v", ".webm")

CALENDAR_RETENTION_DAYS = int(os.getenv("CALENDAR_RETENTION_DAYS", "60"))



# Lazy boto3 import so local dev without boto works
_boto3 = None
def _get_boto3():
    global _boto3
    if _boto3 is None:
        import boto3  # type: ignore
        _boto3 = boto3
    return _boto3

def _s3_client():
    b3 = _get_boto3()
    kw = {}
    if S3_ENDPOINT_URL:
        kw["endpoint_url"] = S3_ENDPOINT_URL
    if S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY:
        kw["aws_access_key_id"] = S3_ACCESS_KEY_ID
        kw["aws_secret_access_key"] = S3_SECRET_ACCESS_KEY
    if S3_REGION:
        kw["region_name"] = S3_REGION
    return b3.client("s3", **kw)

def _s3_public_url(key: str) -> str:
    if S3_PUBLIC_BASE_URL:
        return f"{S3_PUBLIC_BASE_URL}/{key}"
    # Standard AWS URL
    if S3_REGION:
        return f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
    # Gov/other endpoints still work with simple bucket.s3.amazonaws.com
    return f"https://{S3_BUCKET}.s3.amazonaws.com/{key}"


def _infer_caption_from_source(src: str) -> str | None:
    if not src:
        return None
    try:
        path = urlparse(src).path  # handles http(s) URLs
    except Exception:
        path = src
    fname = os.path.basename(unquote(path))  # decode %2A etc.
    m = STAR_CAPTION_RE.search(fname)
    return (m.group(1) if m else None)

# ---------- App ----------
app = FastAPI()

@app.api_route("/api/media/proxy", methods=["GET","HEAD"])
async def api_media_proxy(request: Request, url: str, range: Optional[str] = Header(default=None), ref: Optional[str] = None):
    try:
        # If the URL itself was encoded twice (e.g., %252A), decode once.
        # This turns %25xx back into %xx (so the CDN can resolve the true key).
        if "%25" in url:
            url = unquote(url)
            
        host = urlparse(url).hostname or ""
        if host.endswith("your-public-r2-domain.r2.dev"):
            return Response(status_code=404, media_type="text/plain", content=b"placeholder_url")

        headers = {
            "User-Agent": "SchedulerPreview/1.0 (+http://localhost)",
            "Accept": "*/*",
        }
        if range:
            headers["Range"] = range
        if ref:
            headers["Referer"] = ref

        req = URLReq(url, headers=headers)
        ctx = ssl.create_default_context(cafile=certifi.where())
        resp = await run_in_threadpool(urlopen, req, context=ctx)

        status = getattr(resp, "status", resp.getcode())
        info = resp.info()
        content_type = info.get("Content-Type", "application/octet-stream")
        passthru = {k: info.get(k) for k in ("Content-Length","Content-Range","Accept-Ranges","Cache-Control","ETag","Last-Modified") if info.get(k)}

        if request.method == "HEAD":
            return Response(status_code=status, media_type=content_type, headers=passthru)

        data = await run_in_threadpool(resp.read)
        return Response(content=data, status_code=status, media_type=content_type, headers=passthru)

    except HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        return Response(content=body, status_code=e.code, media_type=(getattr(e, "headers", {}) or {}).get("Content-Type","text/plain"))
    except URLError as e:
        raise HTTPException(status_code=502, detail=f"proxy_failed: {e.reason}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"proxy_failed: {e}")


#@app.get("/media/proxy")
#async def media_proxy(url: str, range: Optional[str] = Header(default=None)):
#    """
#    Simple pass-through for previews. Non-streaming to avoid worker crashes.
#    For large files you can switch to a streaming version later.
#    """
#    req_headers = {}
#    if range:
#        req_headers["Range"] = range

#    timeout = httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0)
#    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
#        resp = await client.get(url, headers=req_headers)

#    ct = resp.headers.get("Content-Type", "application/octet-stream")
#    copy = {}
#    for k in ("Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Last-Modified"):
#        v = resp.headers.get(k)
#        if v:
#            copy[k] = v

#    return Response(content=resp.content, status_code=resp.status_code, media_type=ct, headers=copy)


# CORS (adjust as needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # dev FE
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve local media (for reports and local backend)
os.makedirs(MEDIA_ROOT, exist_ok=True)
if MEDIA_URL_PATH:
    app.mount(MEDIA_URL_PATH, StaticFiles(directory=MEDIA_ROOT), name="media")


# ---------- Helpers ----------
def _slugify(s: str, limit: int = 60) -> str:
    s = s.strip().lower()
    s = "".join(
        ch if ch.isalnum() else "-"
        for ch in s
    )
    s = "-".join(filter(None, s.split("-")))
    return s[:limit] or "post"

def _infer_ext(filename: str, content_type: Optional[str]) -> str:
    ext = ""
    if "." in filename:
        ext = filename.split(".")[-1].lower()
    if not ext and content_type:
        ext_guess = mimetypes.guess_extension(content_type)
        if ext_guess:
            ext = ext_guess.lstrip(".")
    if not ext:
        ext = "bin"
    return ext

def _ensure_absolute(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"{APP_BASE_URL}{url}"

def _dir_for(account_id: int, when: datetime) -> Tuple[str, str, str, str]:
    y = when.strftime("%Y")
    m = when.strftime("%m")
    d = when.strftime("%d")
    return y, m, d, f"{y}/{m}/{d}"

def _build_filename(when: datetime, handle: str, caption_slug: str, hash8: str, ext: str) -> str:
    stamp = when.strftime("%Y%m%d_%H%M")
    return f"{when.strftime('%Y%m%d')}_{when.strftime('%H%M')}_{handle}_{caption_slug}_{hash8}.{ext}"

def _hash_stream(stream: io.BufferedReader) -> str:
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        h.update(chunk)
    return h.hexdigest()

def _hash_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def _account_handle(acc_id: int) -> str:
    rows = query("SELECT handle FROM accounts WHERE id=%s", (acc_id,))
    if not rows:
        raise HTTPException(404, "Account not found")
    return rows[0][0]

def _account_tz(acc_id: int) -> ZoneInfo:
    rows = query("SELECT timezone FROM accounts WHERE id=%s", (acc_id,))
    tz = rows[0][0] if rows else "UTC"
    try:
        return ZoneInfo(tz)
    except Exception:
        return ZoneInfo("UTC")
    
def randomize_time_within_day(day, tzname: str, start_hhmm: str | None = None, end_hhmm: str | None = None) -> datetime:
    """Return a timezone-aware datetime on date `day` between start_hhmm and end_hhmm (default 00:01–23:59) in local tz."""
    tz = ZoneInfo(tzname)

    def parse_hhmm(s: str | None, default: time) -> time:
      if not s:
        return default
      try:
        hh, mm = s.split(":")[0:2]
        h = max(0, min(23, int(hh)))
        m = max(0, min(59, int(mm)))
        return time(h, m)
      except Exception:
        return default

    start_t = parse_hhmm(start_hhmm, time(0, 1))
    end_t   = parse_hhmm(end_hhmm,   time(23, 59))

    start_dt = datetime.combine(day, start_t, tzinfo=tz)
    end_dt   = datetime.combine(day, end_t,   tzinfo=tz)

    # If user swapped them, fix order
    if end_dt < start_dt:
        start_dt, end_dt = end_dt, start_dt

    delta = int((end_dt - start_dt).total_seconds())
    if delta <= 0:
        return start_dt
    return start_dt + timedelta(seconds=random.randint(0, delta))

def _expire_old_posts_for_account(account_id: int, days: int = CALENDAR_RETENTION_DAYS) -> int:
    """
    Hard-delete posts older than `days` before now for this account.
    Applies to all statuses; keeps your DB/calendar tidy automatically.
    """
    rows = query(
        """
        DELETE FROM posts
         WHERE account_id = %s
           AND scheduled_at < (now() - make_interval(days => %s))
        RETURNING id
        """,
        (account_id, days),
    )
    return len(rows)


# ---------- Health ----------
@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/api/health/storage")
def storage_probe():
    from app.s3util import s3_client, S3_BUCKET, S3_PREFIX
    key = f"{S3_PREFIX.strip('/')}/_probe_health.txt"
    s3 = s3_client()
    s3.put_object(Bucket=S3_BUCKET, Key=key, Body=b"ok", ContentType="text/plain")
    obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
    return {"ok": True, "len": obj["ContentLength"], "key": key}


# ---------- Accounts ----------
class AccountRefreshReq(BaseModel):
    # uses META_LONG_LIVED_TOKEN from env by default; you can pass override here if desired
    token: Optional[str] = None
    
class AccountStateResp(BaseModel):
    id: int
    handle: str
    active: bool
    paused: bool = Field(default=False)

def _fail_all_scheduled_for_account(acc_id: int):
    execute(
        """
        UPDATE posts
           SET status='failed',
               error_code='account_paused',
               publish_result = COALESCE(publish_result,'{}'::jsonb) || '{"paused":true,"reason":"manual"}'::jsonb,
               updated_at=now()
         WHERE account_id=%s
           AND status='scheduled'
        """,
        (acc_id,),
    )

@app.post("/api/accounts/{account_id}/freeze", response_model=AccountStateResp)
def freeze_account(account_id: int):
    rows = query("SELECT id, handle, active FROM accounts WHERE id=%s", (account_id,))
    if not rows:
        raise HTTPException(404, "Account not found")
    execute("UPDATE accounts SET active=false WHERE id=%s", (account_id,))
    _fail_all_scheduled_for_account(account_id)
    r = rows[0]
    return {"id": r[0], "handle": r[1], "active": False, "paused": True}

@app.post("/api/accounts/{account_id}/unfreeze", response_model=AccountStateResp)
def unfreeze_account(account_id: int):
    rows = query("SELECT id, handle, active FROM accounts WHERE id=%s", (account_id,))
    if not rows:
        raise HTTPException(404, "Account not found")
    execute("UPDATE accounts SET active=true WHERE id=%s", (account_id,))
    r = rows[0]
    return {"id": r[0], "handle": r[1], "active": True, "paused": False}




@app.get("/api/accounts")
def list_accounts(active: Optional[bool] = None):
    base_sql = "SELECT id, handle, ig_user_id, timezone, active FROM accounts"
    params = []
    if active is not None:
        base_sql += " WHERE active=%s"
        params.append(active)
    base_sql += " ORDER BY id ASC"

    try:
        rows = query(base_sql, tuple(params))
        items = [dict(id=r[0], handle=r[1], ig_user_id=r[2], timezone=r[3], active=r[4]) for r in rows]
        return {"items": items}
    except Exception:
        # Fallback for old schema (id, handle only)
        legacy = query("SELECT id, handle FROM accounts ORDER BY id ASC")
        items = [dict(id=r[0], handle=r[1], ig_user_id=None, timezone="UTC", active=True) for r in legacy]
        # Optional active filter on the synthetic field
        if active is not None:
            items = [it for it in items if it["active"] == active]
        return {"items": items}


@app.post("/api/accounts/refresh")
def refresh_accounts(body: AccountRefreshReq):
    """
    Minimal stub: if token is set and META_GRAPH_VERSION present, fetch IG accounts.
    Otherwise no-op. (You already wired earlier; retaining behavior.)
    """
    token = body.token or os.getenv("META_LONG_LIVED_TOKEN", "")
    if not token:
        return {"ok": True, "note": "No token provided; nothing refreshed."}

    graph_version = os.getenv("META_GRAPH_VERSION", "v19.0")
    import requests

    # Fetch user accounts → instagram_business_account
    me = requests.get(
        f"https://graph.facebook.com/{graph_version}/me/accounts",
        params={"access_token": token, "limit": 100},
        timeout=30,
    ).json()
    pages = me.get("data", [])
    created = 0
    for p in pages:
        page_id = p.get("id")
        if not page_id:
            continue
        ig = requests.get(
            f"https://graph.facebook.com/{graph_version}/{page_id}",
            params={
                "fields": "instagram_business_account{id,username}",
                "access_token": token,
            },
            timeout=30,
        ).json()
        igacct = ig.get("instagram_business_account") or {}
        ig_id = igacct.get("id")
        handle = igacct.get("username")
        if ig_id and handle:
            execute(
                """
                INSERT INTO accounts (handle, ig_user_id, access_token, timezone, active)
                VALUES (%s, %s, %s, %s, true)
                ON CONFLICT (ig_user_id) DO UPDATE SET
                    handle=EXCLUDED.handle,
                    access_token=EXCLUDED.access_token,
                    active=true
                """,
                (handle, int(ig_id), token, "UTC"),
            )
            created += 1

    return {"ok": True, "created": created}


# ---------- Media (Local/S3) ----------
class UploadResult(BaseModel):
    asset_id: int
    media_url: str
    caption_inferred: str

def _store_asset_row(
    account_id: int,
    rel_path: str,
    public_url: str,
    sha256_hex: str,
    size_bytes: int,
    original_name: str,
    content_type: str,
    inferred_caption: str = "",
) -> int:
    """
    Insert media_assets row if new; otherwise return existing id.
    Works with db.execute() that may return:
      - an int id
      - a list/tuple like [(id,)]
      - nothing (when DO NOTHING hits); then we SELECT.
    """
    insert_sql = """
        INSERT INTO media_assets
            (account_id, rel_path, public_url, sha256, size_bytes,
             original_name, content_type, inferred_caption)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (account_id, sha256) DO NOTHING
        RETURNING id
    """
    params = (
        account_id,
        rel_path,
        public_url,
        sha256_hex,
        size_bytes,
        original_name,
        content_type or "application/octet-stream",
        inferred_caption,
    )

    try:
        ret = execute(insert_sql, params)

        # Case A: execute returns a plain integer id
        if isinstance(ret, int):
            return ret

        # Case B: execute returned rows (e.g., [(id,)] or [{"id": ..}])
        if ret:
            first = ret[0]
            if isinstance(first, dict) and "id" in first:
                return int(first["id"])
            if isinstance(first, (list, tuple)) and len(first) >= 1:
                return int(first[0])

        # Case C: DO NOTHING happened (duplicate); fetch existing id
        rows = query(
            "SELECT id FROM media_assets WHERE account_id=%s AND sha256=%s",
            (account_id, sha256_hex),
        )
        if not rows:
            raise RuntimeError(
                "Asset insert returned no id and SELECT by (account_id, sha256) found nothing"
            )
        first = rows[0]
        return int(first["id"] if isinstance(first, dict) else first[0])

    except Exception as e:
        # Extra defensive duplicate handling
        msg = str(e)
        if "duplicate key value" in msg or "UniqueViolation" in e.__class__.__name__:
            rows = query(
                "SELECT id FROM media_assets WHERE account_id=%s AND sha256=%s",
                (account_id, sha256_hex),
            )
            if rows:
                first = rows[0]
                return int(first["id"] if isinstance(first, dict) else first[0])
        raise



def _final_key_for(account_id: int, handle: str, caption_slug: str, when: datetime, hash8: str, ext: str) -> Tuple[str, str]:
    y, m, d, rel_dir = _dir_for(account_id, when)
    filename = _build_filename(when, handle, caption_slug, hash8, ext)
    rel_path = f"{account_id}/{rel_dir}/{filename}"
    return filename, rel_path

@app.post("/api/media/upload", response_model=UploadResult)
def media_upload(
    account_id: int = Form(...),
    caption: str = Form(""),
    file: UploadFile = File(...),
):
    """
    Small/medium uploads handled by API (local or S3).
    For very large files, use presign + finalize endpoints.
    """
    handle = _account_handle(account_id)
    tz = _account_tz(account_id)
    when = datetime.now(tz)

    # Read file into memory for hashing (OK for modest files)
    data = file.file.read()
    if not data:
        raise HTTPException(400, "Empty file upload")

    sha256_hex = _hash_bytes(data)
    hash8 = sha256_hex[:8]

    caption_slug = _slugify(caption or os.path.splitext(file.filename or "upload")[0])
    ext = _infer_ext(file.filename or "", file.content_type)
    filename, rel_path = _final_key_for(account_id, handle, caption_slug, when, hash8, ext)

    content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    caption_inferred = (caption or caption_slug).strip()

    if MEDIA_BACKEND == "s3":
        if not S3_BUCKET:
            raise HTTPException(500, "S3_BUCKET not configured")
        client = _s3_client()
        put_kwargs = {
            "Bucket": S3_BUCKET,
            "Key": rel_path,                 # <-- use computed final key
            "Body": data,
            "ContentType": content_type,
        }
        if S3_ACL:
            put_kwargs["ACL"] = S3_ACL
        client.put_object(**put_kwargs)

        media_url = _s3_public_url(rel_path)
        size_bytes = len(data)

        asset_id = _store_asset_row(
            account_id=account_id,
            rel_path=rel_path,
            public_url=media_url,
            sha256_hex=sha256_hex,
            size_bytes=size_bytes,
            original_name=file.filename or filename,
            content_type=content_type,
            inferred_caption=caption_inferred,
        )
        return {"asset_id": asset_id, "media_url": media_url, "caption_inferred": caption_inferred}


    # --- Local backend ---
    y, m, d, rel_dir = _dir_for(account_id, when)
    abs_dir = os.path.join(MEDIA_ROOT, str(account_id), y, m, d)
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(abs_dir, filename)
    with open(abs_path, "wb") as f:
        f.write(data)

    rel_path_local = f"{account_id}/{y}/{m}/{d}/{filename}"
    media_url = _ensure_absolute(f"{MEDIA_URL_PATH}/{rel_path_local}")
    public_url = ""                 # will be set below per backend
    size_bytes = len(data)          # number of bytes we just read
    content_type = file.content_type or "application/octet-stream"
    

    asset_id = _store_asset_row(
        account_id=account_id,
        rel_path=rel_path_local,
        public_url=media_url,
        sha256_hex=sha256_hex,
        size_bytes=len(data),
        original_name=file.filename or filename,
        content_type=content_type,
        inferred_caption=caption_inferred,
    )
    return {"asset_id": asset_id, "media_url": media_url, "caption_inferred": caption_inferred}


@app.get("/api/media/list")
def api_media_list(
    prefix: str = Query(..., description="R2 'folder' prefix, e.g. customer/4/ig/fall/"),
    sort: Literal["alpha", "modified", "random"] = "alpha",
    order: Literal["asc", "desc"] = "asc",
    limit: int = 2000,
    extensions: Optional[str] = "jpg,jpeg,png,mp4",
    seed: Optional[int] = None,
):
    exts = [e.strip().lower() for e in (extensions or "").split(",") if e.strip()]
    items = s3util.list_media(prefix=prefix, limit=limit, extensions=exts)

    # sort
    reverse = order == "desc"
    if sort == "alpha":
        items.sort(key=lambda x: x["key"], reverse=reverse)
    elif sort == "modified":
        items.sort(key=lambda x: x["last_modified"] or 0, reverse=reverse)
    elif sort == "random":
        rnd = random.Random(seed)
        rnd.shuffle(items)

    # attach URLs
    out = []
    for it in items:
        out.append(
            {
                "key": it["key"],
                "url": s3util.to_public_url(it["key"]),
                "size": it["size"],
                "last_modified": it["last_modified"],
            }
        )
    return {"count": len(out), "items": out}


# ---- Presigned upload flow (S3) ----
class PresignReq(BaseModel):
    account_id: int
    filename: str
    content_type: Optional[str] = None

class PresignResp(BaseModel):
    method: str
    upload_url: str
    required_headers: Dict[str, str]
    upload_key: str  # temporary key to use with finalize

@app.post("/api/media/presign", response_model=PresignResp)
def media_presign(req: PresignReq):
    if MEDIA_BACKEND != "s3":
        raise HTTPException(400, "Presign only available when MEDIA_BACKEND=s3")
    if not S3_BUCKET:
        raise HTTPException(500, "S3_BUCKET not configured")

    safe_base = _slugify(os.path.splitext(req.filename)[0], 80)
    ext = _infer_ext(req.filename, req.content_type)
    tmp_key = f"tmp/{req.account_id}/{datetime.utcnow().strftime('%Y/%m/%d')}/{uuid.uuid4().hex}_{safe_base}.{ext}"

    client = _s3_client()
    params = {
        "Bucket": S3_BUCKET,
        "Key": tmp_key,
    }
    if req.content_type:
        params["ContentType"] = req.content_type
    if S3_ACL:
        params["ACL"] = S3_ACL

    url = client.generate_presigned_url(
        ClientMethod="put_object",
        Params=params,
        ExpiresIn=3600,
    )
    headers = {}
    if req.content_type:
        headers["Content-Type"] = req.content_type
    if S3_ACL:
        headers["x-amz-acl"] = S3_ACL

    return {
        "method": "PUT",
        "upload_url": url,
        "required_headers": headers,
        "upload_key": tmp_key,
    }

class FinalizeReq(BaseModel):
    account_id: int
    upload_key: str
    caption: str = ""
    orig_filename: Optional[str] = None

@app.post("/api/media/finalize", response_model=UploadResult)
def media_finalize(req: FinalizeReq):
    if MEDIA_BACKEND != "s3":
        raise HTTPException(400, "Finalize only available when MEDIA_BACKEND=s3")
    if not S3_BUCKET:
        raise HTTPException(500, "S3_BUCKET not configured")

    handle = _account_handle(req.account_id)
    tz = _account_tz(req.account_id)
    when = datetime.now(tz)

    client = _s3_client()

    # Head to get type/size, then stream to hash
    try:
        head = client.head_object(Bucket=S3_BUCKET, Key=req.upload_key)
    except Exception:
        raise HTTPException(404, "upload_key not found")

    content_type = head.get("ContentType") or "application/octet-stream"
    size = head.get("ContentLength") or 0

    # Stream for SHA-256
    obj = client.get_object(Bucket=S3_BUCKET, Key=req.upload_key)
    body = obj["Body"]
    h = hashlib.sha256()
    for chunk in iter(lambda: body.read(1024 * 1024), b""):
        h.update(chunk)
    sha256_hex = h.hexdigest()
    hash8 = sha256_hex[:8]

    base_for_slug = req.caption or (req.orig_filename or req.upload_key.split("/")[-1])
    caption_slug = _slugify(os.path.splitext(base_for_slug)[0])
    ext = _infer_ext(req.orig_filename or req.upload_key, content_type)
    filename, final_key = _final_key_for(req.account_id, handle, caption_slug, when, hash8, ext)

    # Copy to final key and delete tmp
    copy_source = {"Bucket": S3_BUCKET, "Key": req.upload_key}
    copy_kwargs = {
        "Bucket": S3_BUCKET,
        "Key": final_key,
        "CopySource": copy_source,
        "ContentType": content_type,
        "MetadataDirective": "REPLACE",
    }
    if S3_ACL:
        copy_kwargs["ACL"] = S3_ACL
    client.copy_object(**copy_kwargs)
    client.delete_object(Bucket=S3_BUCKET, Key=req.upload_key)

    media_url = _s3_public_url(final_key)
    original_name = req.orig_filename or filename
    caption_inferred = (req.caption or caption_slug).strip()

    asset_id = _store_asset_row(
    account_id=req.account_id,
    rel_path=final_key,
    public_url=media_url,
    sha256_hex=sha256_hex,
    size_bytes=int(size),
    original_name=original_name,
    content_type=content_type,
    inferred_caption=caption_inferred,
)
    return {"asset_id": asset_id, "media_url": media_url, "caption_inferred": caption_inferred}



# ---------- Posts (existing behavior retained) ----------
class PostCreate(BaseModel):
    account_id: int
    post_type: str
    platform: str = "instagram" 
    asset_id: Optional[int] = None
    media_url: Optional[str] = None
    caption: str = ""
    scheduled_at: datetime
    client_request_id: Optional[str] = None
    override_spacing: bool = False
    
class BulkDeleteRequest(BaseModel):
    ids: List[int] = Field(default_factory=list)

class DeleteAfterRequest(BaseModel):
    account_id: int
    after: datetime  # ISO-8601 string from the UI -> parsed by Pydantic





@app.post("/api/posts")
def create_post(body: PostCreate):
    # Resolve media_url from asset_id if provided
    if body.asset_id and not body.media_url:
        rows = query(
            "SELECT COALESCE(public_url, media_url) FROM media_assets WHERE id=%s AND account_id=%s",
            (body.asset_id, body.account_id),
        )
        if not rows:
            raise HTTPException(status_code=400, detail="asset_id not found for account")
        body.media_url = rows[0][0]
        
    if not (body.caption or "").strip():
        inferred = _infer_caption_from_source(body.media_url or "")
        if inferred:
            body.caption = inferred

    if not body.media_url:
        raise HTTPException(status_code=400, detail="media_url or asset_id is required")
    
    if body.post_type and body.post_type.lower() == "carousel":
        raise HTTPException(status_code=400, detail="Carousels are disabled in v1. Post a single photo or reel.")

    # ---- spacing window computed in Python (no INTERVAL params in SQL) ----
    pad = timedelta(minutes=MIN_SPACING_MINUTES)
    start = body.scheduled_at - pad
    end   = body.scheduled_at + pad

    if not body.override_spacing:
        conflict = query(
            """
            SELECT id, scheduled_at, status
              FROM posts
             WHERE account_id=%s
               AND scheduled_at BETWEEN %s AND %s
               AND status IN ('queued','scheduled','publishing')
             ORDER BY scheduled_at ASC
             LIMIT 1
            """,
            (body.account_id, start, end),
        )
        if conflict:
            cid, at, st = conflict[0]
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "SPACING_CONFLICT",
                    "message": "A post is already scheduled near this time.",
                    "conflict_with": {"id": cid, "scheduled_at": str(at), "status": st},
                    "min_spacing_minutes": MIN_SPACING_MINUTES,
                },
            )

    # Insert (idempotent on (account_id, client_request_id) when present)
    sql = """
    INSERT INTO posts
        (account_id, platform, post_type, media_url, caption, scheduled_at, client_request_id, asset_id)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    RETURNING id
    """
    params = (
        body.account_id,
        body.platform,
        body.post_type,
        body.media_url,
        body.caption,
        body.scheduled_at,
        body.client_request_id,
        body.asset_id,
    )
    ret = execute(sql, params)

    # Normalize the returned id (execute() returns [(id,)] in this project)
    if not ret:
        raise HTTPException(status_code=500, detail="Insert returned no id")
    first = ret[0]
    new_id = int(first[0] if isinstance(first, (list, tuple)) else first)

    # If account is paused, immediately fail the new post so it shows red in UI
    acc_row = query("SELECT active FROM accounts WHERE id=%s", (body.account_id,))
    if acc_row and (acc_row[0][0] is False):
        execute(
            """
            UPDATE posts
               SET status='failed',
                   error_code='account_paused',
                   publish_result = COALESCE(publish_result,'{}'::jsonb) || '{"paused":true,"reason":"create_while_paused"}'::jsonb,
                   updated_at=now()
             WHERE id=%s
            """,
            (new_id,),
        )
        return {"id": new_id, "status": "failed"}

    return {"id": new_id, "status": "scheduled"}

    




@app.get("/api/posts/query")
def posts_query(account_id: int, start: str, end: str):
    # Auto-expire any rows older than CALENDAR_RETENTION_DAYS so the calendar never
    # shows >2 months of past posts.
    try:
        _expire_old_posts_for_account(account_id)
    except Exception:
        # never block the calendar if cleanup fails
        pass
    
    rows = query(
        """
        SELECT id, account_id, platform, post_type, media_url, caption, scheduled_at, status
        FROM posts
        WHERE account_id=%s AND scheduled_at BETWEEN %s AND %s
        ORDER BY scheduled_at ASC
        """,
        (account_id, start, end),
    )
    return {"items": [
        dict(id=r[0], account_id=r[1], platform=r[2], post_type=r[3],
             media_url=r[4], caption=r[5], scheduled_at=r[6], status=r[7])
        for r in rows
    ]}

# optional alias that avoids any ambiguity:
@app.get("/api/posts/window")
def posts_window(account_id: int, start: str, end: str):
    return posts_query(account_id, start, end)

# keep this BELOW the two routes above, and constrain to int:
@app.get("/api/posts/{post_id:int}")
def get_post(post_id: int):
    rows = query(
        """
        SELECT id, account_id, platform, post_type, media_url, caption,
               scheduled_at, status, created_at, updated_at, publish_result,
               error_code, retry_count, client_request_id, content_hash,
               locked_at, asset_id
        FROM posts WHERE id=%s
        """,
        (post_id,),
    )
    if not rows:
        raise HTTPException(404, "Not found")
    r = rows[0]
    return {
        "id": r[0], "account_id": r[1], "platform": r[2], "post_type": r[3],
        "media_url": r[4], "caption": r[5], "scheduled_at": r[6], "status": r[7],
        "created_at": r[8], "updated_at": r[9], "publish_result": r[10] or {},
        "error_code": r[11], "retry_count": r[12], "client_request_id": r[13],
        "content_hash": r[14], "locked_at": r[15], "asset_id": r[16],
    }
    
@app.delete("/api/posts/{post_id}", status_code=204)
def delete_post(post_id: int):
    """Delete a post regardless of status.
       Safe for queued/publishing: worker will no-op if the row is gone."""
    rows = query("DELETE FROM posts WHERE id=%s RETURNING id", (post_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="Not Found")
    return Response(status_code=204)


@app.post("/api/posts/bulk_delete")
def bulk_delete(req: BulkDeleteRequest):
    """Delete many posts by id list. Returns how many were deleted."""
    if not req.ids:
        return {"deleted": 0}
    # psycopg will expand %s with list->array safely
    rows = query("DELETE FROM posts WHERE id = ANY(%s) RETURNING id", (req.ids,))
    return {"deleted": len(rows)}


@app.post("/api/posts/delete_after")
def delete_after(req: DeleteAfterRequest):
    """Delete all FUTURE scheduled posts after the given timestamp for an account.
       Only rows with status='scheduled' are removed (not published/failed)."""
    rows = query(
        """
        DELETE FROM posts
         WHERE account_id = %s
           AND status = 'scheduled'
           AND scheduled_at > %s
        RETURNING id
        """,
        (req.account_id, req.after,),
    )
    return {"deleted": len(rows)}


# ==================== Batch scheduling helpers & endpoints (drop-in) ====================

# Tunables (env overrides allowed)
DAY_START_HOUR = int(os.getenv("DAY_START_HOUR", "8"))    # local day start
DAY_END_HOUR   = int(os.getenv("DAY_END_HOUR",   "22"))   # local day end (exclusive)
DAILY_LIMIT    = int(os.getenv("DAILY_LIMIT",    "15"))   # max scheduled per local day

# ---- helper utils ----
def parse_weekly_plan(plan: dict | list) -> dict[int, int]:
    """
    Accepts:
      - list of 7 ints indexing Mon(0) .. Sun(6)
      - dict with int keys 0..6, or strings like 'mon'..'sun'
    Returns {weekday_int: count}
    """
    if isinstance(plan, list):
        if len(plan) != 7:
            raise HTTPException(422, "weekly_plan list must have 7 entries (Mon..Sun)")
        return {i: int(plan[i]) for i in range(7)}

    if isinstance(plan, dict):
        out: dict[int, int] = {}
        name_to_idx = {
            "mon": 0, "monday": 0,
            "tue": 1, "tuesday": 1,
            "wed": 2, "wednesday": 2,
            "thu": 3, "thursday": 3,
            "fri": 4, "friday": 4,
            "sat": 5, "saturday": 5,
            "sun": 6, "sunday": 6,
        }
        for k, v in plan.items():
            if isinstance(k, int):
                if k < 0 or k > 6:
                    raise HTTPException(422, "weekly_plan int keys must be 0..6 (Mon..Sun)")
                out[k] = int(v)
            else:
                ki = str(k).strip().lower()
                if ki not in name_to_idx:
                    raise HTTPException(422, f"weekly_plan key {k!r} not recognized")
                out[name_to_idx[ki]] = int(v)
        # fill missing days with 0
        for i in range(7):
            out.setdefault(i, 0)
        return out

    raise HTTPException(422, "weekly_plan must be a list of 7 ints or a dict")


def day_list(start: date, end: date) -> List[date]:
    if end < start:
        raise HTTPException(422, "end_date must be >= start_date")
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur = cur + timedelta(days=1)
    return days


def single_local_day_window_to_utc(d: date, tz_str: str) -> Tuple[datetime, datetime]:
    tz = ZoneInfo(tz_str)
    utc = ZoneInfo("UTC")
    start_local = datetime.combine(d, time(DAY_START_HOUR, 0), tzinfo=tz)
    end_local   = datetime.combine(d, time(DAY_END_HOUR,   0), tzinfo=tz)  # end-exclusive
    return start_local.astimezone(utc), end_local.astimezone(utc)

def local_window_to_utc(d: date, tz_str: str, start_hhmm: str | None, end_hhmm: str | None):
    tz = ZoneInfo(tz_str)
    def _parse(s: str | None, default_h: int, default_m: int) -> time:
        if not s:
            return time(default_h, default_m)
        try:
            hh, mm = s.split(":")[0:2]
            return time(max(0,min(23,int(hh))), max(0,min(59,int(mm))))
        except Exception:
            return time(default_h, default_m)
    start_local = datetime.combine(d, _parse(start_hhmm, DAY_START_HOUR, 0), tzinfo=tz)
    end_local   = datetime.combine(d, _parse(end_hhmm,   DAY_END_HOUR,   0), tzinfo=tz)
    if end_local <= start_local:
        end_local = start_local + timedelta(minutes=1)
    utc = ZoneInfo("UTC")
    return start_local.astimezone(utc), end_local.astimezone(utc)



def _round_to_min(dt: datetime, minutes: int = 15) -> datetime:
    # round to nearest N minutes
    discard = (dt.minute % minutes)
    down = dt - timedelta(minutes=discard, seconds=dt.second, microseconds=dt.microsecond)
    up = down + timedelta(minutes=minutes)
    # choose nearer
    return up if (dt - down) >= (up - dt) else down


def spread_times_in_day(d: date, count: int, tz_str: str) -> List[datetime]:
    """
    Evenly spread `count` local datetimes between [DAY_START_HOUR, DAY_END_HOUR),
    rounded to 15-min marks.
    """
    if count <= 0:
        return []
    tz = ZoneInfo(tz_str)
    start = datetime.combine(d, time(DAY_START_HOUR, 0), tzinfo=tz)
    end   = datetime.combine(d, time(DAY_END_HOUR,   0), tzinfo=tz)
    total_sec = (end - start).total_seconds()
    step = total_sec / (count + 1)  # keep away from edges
    pts = []
    for i in range(count):
        t = start + timedelta(seconds=step * (i + 1))
        pts.append(_round_to_min(t, 15))
    # ensure strictly increasing & within window
    pts = [max(start, min(p, end - timedelta(minutes=1))) for p in pts]
    # remove accidental dupes after rounding
    out: List[datetime] = []
    seen = set()
    for p in pts:
        k = (p.hour, p.minute)
        if k not in seen:
            out.append(p)
            seen.add(k)
    return out


def _fetch_existing_times(account_id: int, start_utc: datetime, end_utc: datetime) -> List[datetime]:
    rows = query(
        """
        SELECT scheduled_at
          FROM posts
         WHERE account_id=%s
           AND status IN ('scheduled','queued','publishing')
           AND scheduled_at >= %s AND scheduled_at < %s
        ORDER BY scheduled_at ASC
        """,
        (account_id, start_utc, end_utc),
    )
    return [r[0] for r in rows]


def _has_near_conflict(candidate_utc: datetime, existing_utc: List[datetime], min_spacing_minutes: int) -> bool:
    pad = timedelta(minutes=min_spacing_minutes)
    for t in existing_utc:
        if abs(candidate_utc - t) < pad:
            return True
    return False


def _autoshift_day(account_id: int, d: date, tz_str: str, candidates_local: List[datetime],
                   min_spacing_minutes: int, start_hhmm: str | None = None, end_hhmm: str | None = None) -> Tuple[List[datetime], List[datetime]]:
    """
    Try to fit each candidate inside the local window by nudging ± in 5-min steps
    until no spacing conflicts (against *existing + placed* for this day).
    Returns (placed_utc, unplaced_conflicts_utc).
    """
    start_utc, end_utc = local_window_to_utc(d, tz_str, start_hhmm, end_hhmm)
    existing = _fetch_existing_times(account_id, start_utc, end_utc)
    placed: List[datetime] = []
    bad: List[datetime] = []
    utc = ZoneInfo("UTC")

    # We'll check conflicts against both existing posts and what we place this call
    def _conflict(tu: datetime) -> bool:
        return _has_near_conflict(tu, existing, min_spacing_minutes) or _has_near_conflict(tu, placed, min_spacing_minutes)

    # try each candidate
    for tl in candidates_local:
        base = tl.astimezone(utc)
        if not _conflict(base) and (start_utc <= base < end_utc):
            placed.append(base)
            continue

        # search ± within the local window in 5-min increments
        found = False
        for minutes in range(5, (DAY_END_HOUR - DAY_START_HOUR) * 60, 5):
            for sign in (+1, -1):
                test = base + timedelta(minutes=sign * minutes)
                if start_utc <= test < end_utc and not _conflict(test):
                    placed.append(test)
                    found = True
                    break
            if found:
                break

        if not found:
            # record the base (or closest) as “couldn't fit”
            bad.append(base)

    return placed, bad


def _write_skip_report(entries: List[Dict[str, str]]) -> Optional[str]:
    if not entries:
        return None
    reports_dir = os.path.join(MEDIA_ROOT, "reports")
    os.makedirs(reports_dir, exist_ok=True)
    fname = f"skipped_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    abs_path = os.path.join(reports_dir, fname)
    with open(abs_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date","reason","intended_local_time","intended_utc_time","media_url","note"])
        w.writeheader()
        for e in entries:
            w.writerow(e)
    return _ensure_absolute(f"{MEDIA_URL_PATH}/reports/{fname}")


# ------------------- Batch endpoints (preflight + commit) -------------------
class BatchPreflightReq(BaseModel):
    account_id: int
    start_date: date
    end_date: date
    weekly_plan: dict | list = Field(..., description="Dict or list specifying posts per weekday (Mon..Sun)")
    media_urls: List[str] | None = None
    timezone: str = "UTC"
    autoshift: bool = True
    min_spacing_minutes: int = MIN_SPACING_MINUTES

class BatchCommitReq(BaseModel):
    account_id: int
    start_date: date
    end_date: date
    weekly_plan: Dict[str, int] | Dict[int, int]
    timezone: str = "UTC"
    autoshift: bool = True
    min_spacing_minutes: int = 30
    media_urls: Optional[list[str]] = None
    # NEW:
    random_start: Optional[str] = None  # "HH:MM"
    random_end:   Optional[str] = None  # "HH:MM"
    override_conflicts: bool = False
    video_mode: Literal["feed_and_reels","reels_only"] = "feed_and_reels" 



@app.post("/api/posts/batch/preflight") 
@app.post("/api/posts/batch_preflight")
def batch_preflight(b: BatchPreflightReq):
    """Simulate placement with optional auto-shift; no DB inserts."""
    plan = parse_weekly_plan(b.weekly_plan)
    days = day_list(b.start_date, b.end_date)

    slots_iso: List[str] = []
    conflicts_iso: List[str] = []

    # media content cap (optional placeholder)
    content_available = 1_000_000
    remaining_content = content_available

    for d in days:
        requested = int(plan.get(d.weekday(), 0))
        if requested <= 0:
            continue

        proposed_local = spread_times_in_day(d, requested, b.timezone)

        if b.autoshift:
            placed_utc, conflicts_utc = _autoshift_day(
                b.account_id, d, b.timezone, proposed_local, b.min_spacing_minutes
            )
            # respect remaining content
            if remaining_content < len(placed_utc):
                placed_utc = placed_utc[:remaining_content]
            remaining_content -= len(placed_utc)
            slots_iso.extend(t.isoformat() for t in placed_utc)
            conflicts_iso.extend(t.isoformat() for t in conflicts_utc)
        else:
            start_utc, end_utc = single_local_day_window_to_utc(d, b.timezone)
            existing = _fetch_existing_times(b.account_id, start_utc, end_utc)
            local_utc = [tl.astimezone(ZoneInfo("UTC")) for tl in proposed_local]
            ok, bad = [], []
            for t in local_utc:
                (_has_near_conflict(t, existing, b.min_spacing_minutes) and bad or ok).append(t)
            if remaining_content < len(ok):
                ok = ok[:remaining_content]
            remaining_content -= len(ok)
            slots_iso.extend(t.isoformat() for t in ok)
            conflicts_iso.extend(t.isoformat() for t in bad)

        if remaining_content <= 0:
            break

    return {
        "slots": slots_iso,
        "conflicts": conflicts_iso,
        "content_available": content_available,
        "min_spacing_minutes": b.min_spacing_minutes,
        "autoshift": b.autoshift,
        "timezone": b.timezone,
        "daily_limit": DAILY_LIMIT,
        "window": {"start_hour": DAY_START_HOUR, "end_hour": DAY_END_HOUR},
    }


@app.post("/api/posts/batch/commit") 
@app.post("/api/posts/batch_commit")
def batch_commit(b: BatchCommitReq):
    """
    Create posts per weekly_plan between start_date and end_date (inclusive).
    - Autoshift nudges each candidate within the same local day.
    - Enforces DAILY_LIMIT per local calendar day.
    - Idempotent via (account_id, client_request_id) with pattern batch_<epoch>_<idx>.
    - Skips overflow; returns a downloadable CSV report of skipped items.
    """
    plan = parse_weekly_plan(b.weekly_plan)
    days = day_list(b.start_date, b.end_date)

    created_total = 0
    created_ids: List[int] = []
    per_day: List[Dict[str, int | str]] = []
    skipped_entries: List[Dict[str, str]] = []

    media = b.media_urls or []
    media_len = len(media)
    content_remaining = 1_000_000  # allow reuse of media URLs

    epoch = int(datetime.utcnow().timestamp())
    idx_global = 0

    with pool.connection() as conn:
        with conn.cursor() as cur:
            for d in days:
                requested = int(plan.get(d.weekday(), 0))
                if requested <= 0:
                    continue


                # local day window and existing count
                start_utc, end_utc = local_window_to_utc(d, b.timezone, b.random_start, b.random_end)
                cur.execute(
                    """
                    SELECT count(*) FROM posts
                     WHERE account_id=%s
                       AND status IN ('scheduled','queued','publishing')
                       AND scheduled_at >= %s AND scheduled_at < %s
                    """,
                    (b.account_id, start_utc, end_utc),
                )
                existing_count = int(cur.fetchone()[0])
                room = max(0, DAILY_LIMIT - existing_count)
                
                # If override, free up enough capacity by canceling latest scheduled/queued in the window
                if b.override_conflicts and existing_count + requested > DAILY_LIMIT and existing_count > 0:
                    need_to_free = (existing_count + requested) - DAILY_LIMIT
                    cur.execute(
                        """
                        WITH to_cancel AS (
                          SELECT id
                            FROM posts
                           WHERE account_id=%s
                             AND status IN ('scheduled','queued')
                             AND scheduled_at >= %s AND scheduled_at < %s
                           ORDER BY scheduled_at DESC
                           LIMIT %s
                        )
                        UPDATE posts p
                           SET status='canceled', updated_at=now()
                          FROM to_cancel tc
                         WHERE p.id = tc.id
                        """,
                        (b.account_id, start_utc, end_utc, need_to_free),
                    )
                    room = DAILY_LIMIT
                
                # Generate candidate local times for the requested count in the chosen window
                proposed_local_all = [
                    randomize_time_within_day(d, b.timezone, b.random_start, b.random_end)
                    for _ in range(requested)
                ]
                
                # Hard-cap by remaining room and remaining content
                to_try = min(requested, room, content_remaining)
                candidates_local = proposed_local_all[:to_try]
                overflow_local = proposed_local_all[to_try:]  # skipped: daily cap
                
                # Record overflow (daily cap)
                for i, tl in enumerate(overflow_local):
                    intended_utc = tl.astimezone(ZoneInfo("UTC"))
                    media_url = (media[(created_total + i) % media_len] if media_len else "")
                    skipped_entries.append({
                        "date": d.isoformat(),
                        "reason": "daily_cap",
                        "intended_local_time": tl.isoformat(),
                        "intended_utc_time": intended_utc.isoformat(),
                        "media_url": media_url,
                        "note": f"Limit {DAILY_LIMIT}/day",
                    })
                
                if to_try <= 0:
                    per_day.append({"date": d.isoformat(), "requested": requested, "created": 0})
                    continue
                
                # Place into the day (autoshift or strict)
                if b.autoshift:
                    placed_utc, conflicts_utc = _autoshift_day(
                        b.account_id, d, b.timezone, candidates_local, b.min_spacing_minutes,
                        b.random_start, b.random_end
                    )
                    for j, t_utc in enumerate(conflicts_utc):
                        media_url = (media[(created_total + j) % media_len] if media_len else "")
                        skipped_entries.append({
                            "date": d.isoformat(),
                            "reason": "no_slot",
                            "intended_local_time": candidates_local[min(j, len(candidates_local)-1)].isoformat(),
                            "intended_utc_time": t_utc.isoformat(),
                            "media_url": media_url,
                            "note": "Could not fit within window with spacing",
                        })
                else:
                    existing_times = _fetch_existing_times(b.account_id, start_utc, end_utc)
                    local_utc = [tl.astimezone(ZoneInfo("UTC")) for tl in candidates_local]
                    placed_utc = [t for t in local_utc if not _has_near_conflict(t, existing_times, b.min_spacing_minutes)]
                    for j, t_utc in enumerate(local_utc):
                        if t_utc not in placed_utc:
                            media_url = (media[(created_total + j) % media_len] if media_len else "")
                            skipped_entries.append({
                                "date": d.isoformat(),
                                "reason": "conflict",
                                "intended_local_time": candidates_local[j].isoformat(),
                                "intended_utc_time": t_utc.isoformat(),
                                "media_url": media_url,
                                "note": "Conflicts with existing post",
                            })
                

                # Insert idempotently
                for t_utc in placed_utc:
                    mu = (media[(created_total) % media_len] if media_len else f"{MEDIA_URL_PATH}/placeholder.png")
                    client_request_id = f"batch_{epoch}_{idx_global:06d}"
                    idx_global += 1
                    ptype = _infer_post_type_for_batch(mu, b.video_mode)
                    cap = _infer_caption_from_source(mu) or ""  # <-- infer here

                    cur.execute(
                        """
                        INSERT INTO posts
                          (account_id, platform, post_type, media_url, caption, scheduled_at, client_request_id)
                        VALUES (%s, 'instagram', %s, %s, %s, %s, %s)
                        ON CONFLICT (account_id, client_request_id) WHERE client_request_id IS NOT NULL
                        DO UPDATE SET
                          caption = EXCLUDED.caption,
                          media_url = EXCLUDED.media_url,
                          scheduled_at = EXCLUDED.scheduled_at,
                          updated_at = now()
                        RETURNING id
                        """,
                        (b.account_id, ptype, mu, cap, t_utc, client_request_id),
                    )
                    new_id = cur.fetchone()[0]
                    created_ids.append(new_id)
                    created_total += 1
                    content_remaining -= 1
                    if content_remaining <= 0:
                        break

                per_day.append({"date": d.isoformat(), "requested": requested, "created": len(placed_utc)})
                if content_remaining <= 0:
                    break

        conn.commit()

    skip_report_url = _write_skip_report(skipped_entries) if skipped_entries else None

    return {
        "ok": True,
        "created": created_total,
        "created_ids": created_ids,
        "per_day": per_day,
        "daily_limit": DAILY_LIMIT,
        "timezone": b.timezone,
        "autoshift": b.autoshift,
        "min_spacing_minutes": b.min_spacing_minutes,
        "skipped": skipped_entries[:50],
        "skipped_report_url": skip_report_url,
        "window": {"start_hour": DAY_START_HOUR, "end_hour": DAY_END_HOUR},
    }
# ================== /Batch scheduling helpers & endpoints ==================

def _infer_post_type_for_batch(url: str, video_mode: str) -> str:
    ext = os.path.splitext(url.split("?",1)[0].lower())[1]
    if ext in VIDEO_EXTS:
        return "reel_feed" if video_mode == "feed_and_reels" else "reel_only"
    return "photo"


@app.post("/api/accounts/{account_id}/clear_old_posts")
def clear_old_posts(account_id: int, before: Optional[datetime] = None):
    """
    Delete all posts for this account scheduled strictly before `before` (default now()).
    Useful for the 'Clear old posts' action in the UI.
    """
    cutoff = before or datetime.now(timezone.utc)
    rows = query(
        """
        DELETE FROM posts
         WHERE account_id=%s
           AND scheduled_at < %s
        RETURNING id
        """,
        (account_id, cutoff),
    )
    return {"deleted": len(rows), "before": cutoff.isoformat()}