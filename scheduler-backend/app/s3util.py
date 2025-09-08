import os
import re
import hashlib
from datetime import datetime
from typing import IO, Tuple, List, Dict, Optional

import boto3
from botocore.config import Config
from urllib.parse import quote


# ========== Env compatibility (accept S3_* or R2_* names) ==========
def getenv_any(*keys: str, default: Optional[str] = "") -> str:
    for k in keys:
        v = os.getenv(k)
        if v not in (None, ""):
            return v
    return default or ""

R2_BUCKET            = getenv_any("R2_BUCKET", "S3_BUCKET")
R2_ACCESS_KEY_ID     = getenv_any("R2_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = getenv_any("R2_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY")
R2_ENDPOINT_URL      = getenv_any("R2_ENDPOINT_URL", "S3_ENDPOINT_URL")
R2_PUBLIC_BASE_URL   = getenv_any("R2_PUBLIC_BASE_URL", "S3_PUBLIC_BASE_URL")
R2_REGION            = getenv_any("R2_REGION", "S3_REGION", default="auto")
R2_PREFIX            = getenv_any("R2_PREFIX", "S3_PREFIX", default="").strip("/")
R2_OBJECT_ACL_PUBLIC_READ = getenv_any("R2_OBJECT_ACL_PUBLIC_READ", "S3_OBJECT_ACL_PUBLIC_READ", default="false").lower() in ("1","true","yes","on")


# ========== Utils ==========
_slug_re = re.compile(r"[^a-zA-Z0-9]+")

def slugify(s: str, maxlen: int = 60) -> str:
    s = (s or "").strip().lower()
    s = _slug_re.sub("-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:maxlen] or "post"

def _timestamp(dt: datetime) -> str:
    return dt.strftime("%Y%m%d_%H%M%S")

def _date_parts(dt: datetime):
    return dt.strftime("%Y"), dt.strftime("%m"), dt.strftime("%d")

def hash_and_size(fileobj: IO[bytes]) -> Tuple[str, int]:
    """Return (sha256_hex, size_bytes) and rewind fileobj."""
    h = hashlib.sha256()
    fileobj.seek(0)
    total = 0
    while True:
        chunk = fileobj.read(1024 * 1024)
        if not chunk:
            break
        h.update(chunk)
        total += len(chunk)
    fileobj.seek(0)
    return h.hexdigest(), total


# ========== boto3 client ==========
def _client():
    cfg = Config(s3={"addressing_style": "path"})
    kwargs = {"region_name": R2_REGION, "config": cfg}
    if R2_ENDPOINT_URL:
        kwargs["endpoint_url"] = R2_ENDPOINT_URL
    if R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY:
        kwargs["aws_access_key_id"] = R2_ACCESS_KEY_ID
        kwargs["aws_secret_access_key"] = R2_SECRET_ACCESS_KEY
    return boto3.client("s3", **kwargs)


# ========== URL helpers ==========
def to_public_url(key: str, *, expires_sec: int = 3600) -> str:
    """
    Key -> usable URL. Prefer your public base URL; otherwise presign a GET.
    """
    if R2_PUBLIC_BASE_URL:
        return f"{R2_PUBLIC_BASE_URL.rstrip('/')}/{quote(key)}"
    c = _client()
    return c.generate_presigned_url(
        "get_object",
        Params={"Bucket": R2_BUCKET, "Key": key},
        ExpiresIn=int(expires_sec),
    )

def public_url_for(key: str) -> str:
    """
    Non-expiring public URL if CDN/public route is configured; else falls back
    to endpoint + bucket path style.
    """
    if R2_PUBLIC_BASE_URL:
        return f"{R2_PUBLIC_BASE_URL.rstrip('/')}/{quote(key)}"
    if R2_ENDPOINT_URL:
        return f"{R2_ENDPOINT_URL.rstrip('/')}/{R2_BUCKET}/{quote(key)}"
    return f"/{quote(key)}"


# ========== Upload ==========
def _guess_ext(original_filename: str, content_type: str) -> str:
    if "." in (original_filename or ""):
        ext = original_filename.rsplit(".", 1)[-1].lower()
        if ext:
            return ext
    mapping = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "image/gif": "gif",
    }
    return mapping.get((content_type or "").lower(), "bin")

def build_key(*, account_id: int, handle: str, caption: str, hash8: str, ext: str, now: Optional[datetime] = None) -> str:
    now = now or datetime.utcnow()
    y, m, d = _date_parts(now)
    stored = f"{_timestamp(now)}_{handle}_{slugify(caption)}_{hash8}.{ext}"
    parts = [str(account_id), y, m, d, stored]
    if R2_PREFIX:
        parts.insert(0, R2_PREFIX)
    return "/".join(parts)

def upload_stream(
    fileobj: IO[bytes],
    *,
    account_id: int,
    handle: str,
    original_filename: str,
    content_type: str,
    caption: str = "",
) -> Dict[str, object]:
    """
    Stream to R2/S3 and return info:
    { 'key','url','stored_filename','sha256_hex','size_bytes' }
    """
    sha, size = hash_and_size(fileobj)
    ext = _guess_ext(original_filename or "", content_type or "")
    key = build_key(account_id=account_id, handle=handle or "acc", caption=caption or "", hash8=sha[:8], ext=ext)
    stored_filename = key.split("/")[-1]

    extra = {"ContentType": content_type or "application/octet-stream"}
    if R2_OBJECT_ACL_PUBLIC_READ:
        extra["ACL"] = "public-read"

    c = _client()
    c.upload_fileobj(fileobj, R2_BUCKET, key, ExtraArgs=extra)

    return {
        "key": key,
        "url": public_url_for(key),
        "stored_filename": stored_filename,
        "sha256_hex": sha,
        "size_bytes": size,
    }


# ========== Folder / prefix listing ==========
def list_media(prefix: str, *, limit: int = 2000, extensions: Optional[List[str]] = None) -> List[Dict[str, object]]:
    """
    List objects under a prefix ("folder") -> [{ key, size, last_modified }]
    - Skips directory placeholders (keys ending with '/')
    - Filter by extensions (lowercase, no dot) if provided
    """
    if not prefix:
        raise ValueError("prefix required")

    norm = prefix.lstrip("/")
    if not norm.endswith("/"):
        norm += "/"

    exts = [e.lower() for e in (extensions or []) if e]
    c = _client()
    paginator = c.get_paginator("list_objects_v2")
    items: List[Dict[str, object]] = []

    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=norm):
        for obj in page.get("Contents", []):
            key = obj.get("Key")
            if not key or str(key).endswith("/"):
                continue
            if exts:
                ext = str(key).rsplit(".", 1)[-1].lower() if "." in str(key) else ""
                if ext not in exts:
                    continue
            items.append(
                {
                    "key": key,
                    "size": obj.get("Size"),
                    "last_modified": obj.get("LastModified"),
                }
            )
            if len(items) >= limit:
                return items
    return items
