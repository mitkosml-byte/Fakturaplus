"""The photos of supplier invoices in the file storage (P1-4), not in the
database: kept inside each invoice, a few scans a day filled the free
database plan in about a year.

With a file storage set up (services/object_storage), a new invoice's pages
go there under photos/<company>/invoices/<invoice>/<n>.<ext>, and the
invoice keeps only their keys (image_keys). The photos already in the
database move there a batch at a time (move_invoice_photos). Without a file
storage, nothing changes. Whoever reads an invoice gets its pages as before
(data URIs), from wherever they are kept - and only ever its own company's.
"""
from __future__ import annotations

import base64
import binascii
import re
from typing import Any, Dict, List, Optional, Tuple

from services import object_storage

PREFIX = "photos/"
_DATA_URI = re.compile(r"^data:([\w.+-]+/[\w.+-]+);base64,", re.IGNORECASE)
_EXTENSIONS = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
               "image/heic": "heic", "image/gif": "gif", "application/pdf": "pdf"}
_TYPES = {ext: kind for kind, ext in _EXTENSIONS.items() if kind != "image/jpg"}


def company_prefix(company_id: str) -> str:
    return f"{PREFIX}{company_id}/"


def _split(page: str) -> Optional[Tuple[bytes, str]]:
    """The bytes and the kind of one page, from a data URI or bare base64."""
    text = str(page or "").strip()
    if not text:
        return None
    content_type = "image/jpeg"
    found = _DATA_URI.match(text)
    if found:
        content_type = found.group(1).lower()
        text = text[found.end():]
    try:
        raw = base64.b64decode(text, validate=False)
    except (binascii.Error, ValueError):
        return None
    if not raw:
        return None
    return raw, content_type


def pages_of(doc: Dict[str, Any]) -> List[str]:
    """The pages a record keeps in itself (the older single field too)."""
    pages = [p for p in (doc.get("image_base64s") or []) if p]
    if not pages and doc.get("image_base64"):
        pages = [doc["image_base64"]]
    return pages


def has_pages(doc: Dict[str, Any]) -> bool:
    return bool(pages_of(doc) or doc.get("image_keys"))


async def store_invoice_pages(company_id: str, invoice_id: str, pages: List[str]) -> List[str]:
    """Puts an invoice's pages in the file storage; their keys, in order."""
    keys: List[str] = []
    for number, page in enumerate(pages):
        split = _split(page)
        if split is None:
            continue
        raw, content_type = split
        key = f"{company_prefix(company_id)}invoices/{invoice_id}/{number}.{_EXTENSIONS.get(content_type, 'jpg')}"
        await object_storage.put(key, raw, content_type)
        keys.append(key)
    return keys


async def load_pages(company_id: Optional[str], keys: List[str]) -> List[str]:
    """The pages under these keys as data URIs - only the company's own: a
    key that points anywhere else is never read."""
    if not company_id or not keys or not object_storage.enabled():
        return []
    own = company_prefix(company_id)
    pages: List[str] = []
    for key in keys:
        if not isinstance(key, str) or not key.startswith(own) or ".." in key:
            continue
        raw = await object_storage.get(key)
        if raw is None:
            continue
        content_type = _TYPES.get(key.rsplit(".", 1)[-1].lower(), "image/jpeg")
        pages.append(f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}")
    return pages


async def with_pages(company_id: Optional[str], invoice: Dict[str, Any]) -> Dict[str, Any]:
    """The invoice with its pages in image_base64s, as the app reads them."""
    keys = invoice.pop("image_keys", None)
    if keys:
        invoice["image_base64s"] = await load_pages(company_id, list(keys))
        invoice["image_base64"] = None
    return invoice


async def keep_new_invoice_pages(company_id: Optional[str], invoice: Dict[str, Any]) -> None:
    """A new invoice's pages go to the file storage when there is one; kept
    in the invoice as before when there is none or it fails."""
    pages = pages_of(invoice)
    if not company_id or not pages or not object_storage.enabled():
        return
    try:
        keys = await store_invoice_pages(company_id, invoice["id"], pages)
    except Exception:
        return  # the photos stay in the invoice - nothing is lost
    if keys:
        invoice["image_keys"] = keys
        invoice["image_base64s"] = None
        invoice["image_base64"] = None


async def move_invoice_photos(db: Any, batch: int = 100) -> int:
    """Moves photos kept inside invoices to the file storage, a batch at a
    time (the job runs every hour). An invoice gives up its photos only once
    they are stored. Returns how many invoices were moved."""
    if not object_storage.enabled():
        return 0
    query = {
        "company_id": {"$nin": [None, ""]},
        "photos_unmovable": {"$ne": True},
        "$or": [{"image_base64s.0": {"$exists": True}}, {"image_base64": {"$nin": [None, ""]}}],
    }
    moved = 0
    cursor = db.invoices.find(query, {"_id": 0, "id": 1, "company_id": 1, "image_base64": 1, "image_base64s": 1}).limit(batch)
    for invoice in await cursor.to_list(batch):
        pages = pages_of(invoice)
        keys = await store_invoice_pages(invoice["company_id"], invoice["id"], pages)
        if len(keys) != len(pages):
            # A page that is not a picture: the invoice keeps its photos as
            # they are and is not tried again.
            for key in keys:
                await object_storage.delete(key)
            await db.invoices.update_one({"id": invoice["id"], "company_id": invoice["company_id"]},
                                         {"$set": {"photos_unmovable": True}})
            continue
        await db.invoices.update_one(
            {"id": invoice["id"], "company_id": invoice["company_id"]},
            {"$set": {"image_keys": keys}, "$unset": {"image_base64": "", "image_base64s": ""}},
        )
        moved += 1
    return moved
