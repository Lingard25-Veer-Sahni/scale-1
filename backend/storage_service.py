"""Supabase Storage-backed upload helper.

Uploaded files used to live on local disk (backend/storage/). That's fine on
a single long-running machine, but on Render the container filesystem is
ephemeral: every redeploy, restart, or free-tier idle-spindown wipes it.
That was the confirmed cause of uploaded community/event photos disappearing
in production even though their metadata (file_refs rows) survived fine in
Postgres — the DB row pointed at a file that no longer existed on disk.

This now persists every upload to a Supabase Storage bucket over the same
Storage REST API, using the same service-role key already used for the
Postgres/PostgREST data layer in pg_shim.py. Storage lives in Supabase, not
in the container, so uploads survive redeploys/restarts/cold-starts exactly
like every other piece of admin-entered data already does.

Function signatures (init_storage/put_object/get_object/build_upload_path)
are unchanged from the old local-disk version, so no caller in server.py
needs to change. Calls are synchronous (httpx.Client, not AsyncClient) to
keep every existing call site in server.py working without threading
`await` through 8 call sites — uploads are admin-only and low-volume, so a
brief blocking HTTP call is an acceptable, deliberate trade-off (same
simplicity-over-purity call made in pg_shim.py's update_one).
"""
import logging
import os
import uuid

import httpx

logger = logging.getLogger(__name__)

APP_NAME = "scale-india"
BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "uploads")

_SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
_SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
_STORAGE_URL = f"{_SUPABASE_URL}/storage/v1"
_HEADERS = {"apikey": _SUPABASE_KEY, "Authorization": f"Bearer {_SUPABASE_KEY}"}

_client = httpx.Client(timeout=30.0)
_bucket_ready = False


def init_storage() -> str:
    """Ensure the Storage bucket exists. Safe to call repeatedly (checked
    once per process via _bucket_ready, re-verified lazily if that flag was
    never set e.g. due to a transient failure on a previous attempt)."""
    global _bucket_ready
    if _bucket_ready:
        return BUCKET
    if not _SUPABASE_URL or not _SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL/SUPABASE_SECRET_KEY not configured — cannot init storage")

    resp = _client.get(f"{_STORAGE_URL}/bucket/{BUCKET}", headers=_HEADERS)
    # Supabase Storage returns this as HTTP 400 with a "NoSuchBucket" body,
    # not a literal 404 — confirmed against the live project, so check the
    # error code/text rather than trusting the status code alone.
    bucket_missing = resp.status_code == 404 or (
        resp.status_code == 400 and "nosuchbucket" in resp.text.lower()
    )
    if bucket_missing:
        create = _client.post(
            f"{_STORAGE_URL}/bucket",
            headers=_HEADERS,
            json={"id": BUCKET, "name": BUCKET, "public": True},
        )
        # 400 "Duplicate" can happen under a race between two workers booting
        # at once; treat it the same as already-exists rather than failing.
        if create.status_code >= 400 and "duplicate" not in create.text.lower():
            raise RuntimeError(f"Failed to create storage bucket: {create.status_code} {create.text}")
    elif resp.status_code >= 400:
        raise RuntimeError(f"Failed to check storage bucket: {resp.status_code} {resp.text}")

    _bucket_ready = True
    logger.info("Supabase Storage bucket '%s' ready", BUCKET)
    return BUCKET


def put_object(path: str, data: bytes, content_type: str) -> dict:
    init_storage()
    resp = _client.post(
        f"{_STORAGE_URL}/object/{BUCKET}/{path}",
        headers={
            **_HEADERS,
            "Content-Type": content_type or "application/octet-stream",
            "x-upsert": "true",
        },
        content=data,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Upload failed: {resp.status_code} {resp.text}")
    return {"path": path, "size": len(data), "content_type": content_type}


def get_object(path: str) -> tuple[bytes, str]:
    init_storage()
    resp = _client.get(f"{_STORAGE_URL}/object/{BUCKET}/{path}", headers=_HEADERS)
    if resp.status_code == 404:
        raise FileNotFoundError(path)
    if resp.status_code >= 400:
        raise RuntimeError(f"Download failed: {resp.status_code} {resp.text}")
    ctype = resp.headers.get("content-type", "application/octet-stream")
    return resp.content, ctype


def build_upload_path(kind: str, ext: str) -> str:
    ext = (ext or "bin").lower().lstrip(".")
    return f"{APP_NAME}/{kind}/{uuid.uuid4()}.{ext}"
