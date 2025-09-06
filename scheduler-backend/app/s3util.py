import os
import re
import hashlib
from datetime import datetime, timezone
from typing import IO, Tuple

import boto3
from botocore.config import Config

AWS_REGION = os.getenv("S3_REGION", "auto")
S3_BUCKET = os.getenv("S3_BUCKET", "")
S3_PREFIX = os.getenv("S3_PREFIX", "").strip("/")
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL", "").rstrip("/")
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "").rstrip("/")
S3_OBJECT_ACL_PUBLIC_READ = os.getenv("S3_OBJECT_ACL_PUBLIC_READ", "false").lower() in ("1","true","yes","on")

_slug_re = re.compile(r"[^a-zA-Z0-9]+")

def slugify(s: str, maxlen: int = 60) -> str:
    s = s.strip().lower()
    s = _slug_re.sub("-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:maxlen] or "post"

def _date_parts(dt: datetime):
    return dt.strftime("%Y"), dt.strftime("%m"), dt.strftime("%d")

def _timestamp(dt: datetime):
    return dt.strftime("%Y%m%d_%H%M")

def hash_and_size(fileobj: IO[bytes]) -> Tuple[str, int]:
    """Return (sha256_hex, size_bytes) and rewind fileobj."""
    h = hashlib.sha256()
    fileobj.seek(0)
    size = 0
    while True:
        chunk = fileobj.read(1024 * 1024)
        if not chunk:
            break
        h.update(chunk)
        size += len(chunk)
    fileobj.seek(0)
    return h.hexdigest(), size

def build_key(account_id: int, handle: str, caption_slug: str, hash8: str, ext: str, now: datetime) -> str:
    y, m, d = _date_parts(now)
    stored = f"{_timestamp(now)}_{handle}_{caption_slug}_{hash8}.{ext}"
    parts = [str(account_id), y, m, d, stored]
    if S3_PREFIX:
        parts.insert(0, S3_PREFIX)
    return "/".join(parts)

def public_url_for(key: str) -> str:
    # R2 & generic S3-compatible providers: always prefer explicit base URL
    if S3_PUBLIC_BASE_URL:
        return f"{S3_PUBLIC_BASE_URL}/{key}"
    # If not set, fall back to endpoint + bucket (virtual-host style not always available)
    if S3_ENDPOINT_URL:
        return f"{S3_ENDPOINT_URL}/{S3_BUCKET}/{key}"
    # Last resort (won't work for R2 without endpoint): caller should set S3_PUBLIC_BASE_URL
    return f"/{key}"

def _boto3_client():
    cfg = Config(s3={"addressing_style": "virtual"})
    kwargs = {
        "region_name": AWS_REGION,
        "config": cfg,
    }
    if S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)

def upload_stream(fileobj: IO[bytes], *, account_id: int, handle: str,
                  original_filename: str, content_type: str, caption: str) -> dict:
    """
    Streams to S3/R2 and returns:
    { 'key','url','stored_filename','sha256_hex','size_bytes' }
    """
    assert S3_BUCKET, "S3_BUCKET must be set"
    now = datetime.now(timezone.utc)
    # ext from filename; fallback by content-type
    ext = (original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "").strip()
    if not ext:
        if content_type == "image/jpeg": ext = "jpg"
        elif content_type == "image/png": ext = "png"
        elif content_type == "image/webp": ext = "webp"
        elif content_type == "video/mp4": ext = "mp4"
        else: ext = "bin"

    caption_slug = slugify(caption or original_filename.rsplit(".",1)[0])
    sha256_hex, size_bytes = hash_and_size(fileobj)
    hash8 = sha256_hex[:8]
    key = build_key(account_id, handle, caption_slug, hash8, ext, now)
    stored_filename = key.split("/")[-1]

    s3 = _boto3_client()
    extra = {"ContentType": content_type}
    if S3_OBJECT_ACL_PUBLIC_READ:
        extra["ACL"] = "public-read"

    s3.upload_fileobj(fileobj, S3_BUCKET, key, ExtraArgs=extra)
    url = public_url_for(key)
    return {
        "key": key,
        "url": url,
        "stored_filename": stored_filename,
        "sha256_hex": sha256_hex,
        "size_bytes": size_bytes,
    }
