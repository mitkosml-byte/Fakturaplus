"""Files kept outside the database: the daily backups (P1-3) and the photos
of invoices (P1-4), in an S3-compatible bucket - Cloudflare R2, Backblaze
B2, AWS S3, MinIO... - named by four settings:

    STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY
    and, for anything but AWS itself, STORAGE_S3_ENDPOINT (its https address);
    STORAGE_S3_REGION when the provider asks for one ("auto" otherwise).

Off until they are set: then the program keeps everything in the database,
as before. The bucket must stay private - nothing here makes a file public.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol


@dataclass
class StoredFile:
    key: str
    size: int
    modified: datetime


class Backend(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> Optional[bytes]: ...
    def delete(self, key: str) -> None: ...
    def list(self, prefix: str) -> List[StoredFile]: ...


class S3Backend:
    """The bucket through boto3 (blocking - every call goes to a thread)."""

    def __init__(self, bucket: str, access_key: str, secret_key: str, endpoint: str = "", region: str = "auto"):
        import boto3  # type: ignore[import-untyped]
        from botocore.config import Config  # type: ignore[import-untyped]

        self.bucket = bucket
        self.client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint or None,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region or "auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"},
                          connect_timeout=10, read_timeout=60),
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> Optional[bytes]:
        try:
            reply = self.client.get_object(Bucket=self.bucket, Key=key)
        except self.client.exceptions.NoSuchKey:
            return None
        except Exception as e:  # a missing key can also come back as a plain 404
            if getattr(e, "response", {}).get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return reply["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def list(self, prefix: str) -> List[StoredFile]:
        found: List[StoredFile] = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []) or []:
                modified = item.get("LastModified") or datetime.now(timezone.utc)
                found.append(StoredFile(key=item["Key"], size=int(item.get("Size") or 0), modified=modified))
        return found


class MemoryBackend:
    """A bucket in memory - for the tests and the local preview."""

    def __init__(self) -> None:
        self.files: Dict[str, bytes] = {}
        self.types: Dict[str, str] = {}
        self.times: Dict[str, datetime] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.files[key] = bytes(data)
        self.types[key] = content_type
        self.times[key] = datetime.now(timezone.utc)

    def get(self, key: str) -> Optional[bytes]:
        return self.files.get(key)

    def delete(self, key: str) -> None:
        self.files.pop(key, None)
        self.types.pop(key, None)
        self.times.pop(key, None)

    def list(self, prefix: str) -> List[StoredFile]:
        return [StoredFile(key=k, size=len(v), modified=self.times[k])
                for k, v in sorted(self.files.items()) if k.startswith(prefix)]


_backend: Optional[Backend] = None
_configured = False


def _from_settings() -> Optional[Backend]:
    bucket = os.environ.get("STORAGE_S3_BUCKET", "").strip()
    access_key = os.environ.get("STORAGE_S3_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("STORAGE_S3_SECRET_ACCESS_KEY", "").strip()
    if not (bucket and access_key and secret_key):
        return None
    return S3Backend(
        bucket, access_key, secret_key,
        endpoint=os.environ.get("STORAGE_S3_ENDPOINT", "").strip(),
        region=os.environ.get("STORAGE_S3_REGION", "").strip() or "auto",
    )


def backend() -> Optional[Backend]:
    global _backend, _configured
    if not _configured:
        _backend = _from_settings()
        _configured = True
    return _backend


def use(store: Optional[Backend]) -> None:
    """Puts a bucket in place (the tests, the preview) - None turns it off."""
    global _backend, _configured
    _backend = store
    _configured = True


def enabled() -> bool:
    return backend() is not None


def _required() -> Backend:
    store = backend()
    if store is None:
        raise RuntimeError("No file storage is set up")
    return store


async def put(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    await asyncio.to_thread(_required().put, key, data, content_type)


async def get(key: str) -> Optional[bytes]:
    return await asyncio.to_thread(_required().get, key)


async def delete(key: str) -> None:
    await asyncio.to_thread(_required().delete, key)


async def list_files(prefix: str) -> List[StoredFile]:
    return await asyncio.to_thread(_required().list, prefix)
