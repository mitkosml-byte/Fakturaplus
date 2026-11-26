"""Invoice photos in the file storage, not in the database (P1-4): kept
inside each invoice, a few scans a day filled the free database plan in
about a year.

- With a file storage, a new invoice's pages go there; the invoice keeps
  their keys; reading the invoice gives the pages as before.
- The photos already inside invoices move there a batch at a time.
- A company reads only its own photos, whatever a record says.
- Without a file storage nothing changes.

Invented suppliers and pictures."""
import asyncio
import base64
import io
import uuid
import zipfile

import pytest

import server
from services import object_storage, photo_store
from tests.test_whole_program_fixes import _company

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x01" * 40).decode("ascii")
JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x02" * 60).decode("ascii")


@pytest.fixture
def bucket():
    store = object_storage.MemoryBackend()
    object_storage.use(store)
    yield store
    object_storage.use(None)


def _invoice(client, owner, **extra):
    body = {"supplier": "Доставчик Снимка", "invoice_number": uuid.uuid4().hex[:8], "date": "2026-10-05",
            "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120, "payment_method": "cash", **extra}
    reply = client.post("/api/invoices", headers=owner, json=body)
    assert reply.status_code == 200, reply.text
    return reply.json()


def _stored(invoice_id):
    return asyncio.run(server.db.invoices.find_one({"id": invoice_id}, {"_id": 0}))


def test_a_new_invoice_keeps_its_pages_in_the_file_storage(client, bucket):
    company_id, _, owner = _company()
    made = _invoice(client, owner, image_base64s=[PNG, JPEG])
    # The reply still carries the pages as sent.
    assert made["image_base64s"] == [PNG, JPEG]

    doc = _stored(made["id"])
    assert doc.get("image_base64s") is None and doc.get("image_base64") is None
    assert doc["image_keys"] == [
        f"photos/{company_id}/invoices/{made['id']}/0.png",
        f"photos/{company_id}/invoices/{made['id']}/1.jpg",
    ]
    assert bucket.files[doc["image_keys"][0]].startswith(b"\x89PNG")

    # Read back as the app reads it: the same pages, in order.
    seen = client.get(f"/api/invoices/{made['id']}", headers=owner).json()
    assert seen["image_base64s"] == [PNG, JPEG]
    assert "image_keys" not in seen


def test_the_photos_in_the_database_move_a_batch_at_a_time(client, bucket):
    company_id, owner_id, owner = _company()
    object_storage.use(None)
    old = _invoice(client, owner, image_base64=PNG)          # before the file storage
    assert _stored(old["id"])["image_base64"] == PNG
    broken_id = uuid.uuid4().hex
    asyncio.run(server.db.invoices.insert_one({
        "id": broken_id, "company_id": company_id, "user_id": owner_id, "supplier": "Счупена",
        "invoice_number": "X-1", "total_amount": 12, "amount_without_vat": 10, "vat_amount": 2,
        "date": "2026-10-05", "image_base64s": ["%%% не е снимка %%%"],
    }))
    object_storage.use(bucket)

    moved = asyncio.run(photo_store.move_invoice_photos(server.db, batch=1000))
    assert moved >= 1
    doc = _stored(old["id"])
    assert "image_base64" not in doc and doc["image_keys"] == [f"photos/{company_id}/invoices/{old['id']}/0.png"]
    assert client.get(f"/api/invoices/{old['id']}", headers=owner).json()["image_base64s"] == [PNG]
    # A page that is not a picture stays where it is and is not tried again.
    broken = _stored(broken_id)
    assert broken["image_base64s"] == ["%%% не е снимка %%%"] and broken["photos_unmovable"] is True
    assert not [k for k in bucket.files if f"/{broken_id}/" in k]
    assert asyncio.run(photo_store.move_invoice_photos(server.db, batch=1000)) == 0


def test_a_company_reads_only_its_own_photos(client, bucket):
    company_a, _, owner_a = _company()
    company_b, owner_b_id, owner_b = _company()
    theirs = _invoice(client, owner_a, image_base64s=[PNG])
    key = _stored(theirs["id"])["image_keys"][0]
    # A record in another company that points at those photos (say, from a
    # backup file made up to do so) shows nothing.
    mine_id = uuid.uuid4().hex
    asyncio.run(server.db.invoices.insert_one({
        "id": mine_id, "company_id": company_b, "user_id": owner_b_id, "supplier": "Чужда",
        "invoice_number": "Y-1", "total_amount": 12, "amount_without_vat": 10, "vat_amount": 2,
        "date": "2026-10-05", "image_keys": [key, "../" + key],
    }))
    assert client.get(f"/api/invoices/{mine_id}", headers=owner_b).json()["image_base64s"] == []
    assert client.get(f"/api/invoices/{theirs['id']}", headers=owner_b).status_code == 404


def test_the_accountant_pack_still_holds_the_photo(client, bucket):
    _, _, owner = _company()
    _invoice(client, owner, supplier="Строй Депо", invoice_number="W-1", image_base64=PNG)
    pack = client.get("/api/accountant-pack?month=2026-10", headers=owner).json()
    assert pack["counts"]["scanned"] == 1
    archive = client.get("/api/accountant-pack/zip?month=2026-10", headers=owner)
    names = zipfile.ZipFile(io.BytesIO(archive.content)).namelist()
    assert "pokupki/2026-10-05_Stroy-Depo_W-1.png" in names


def test_without_a_file_storage_nothing_changes(client):
    _, _, owner = _company()
    made = _invoice(client, owner, image_base64s=[PNG])
    doc = _stored(made["id"])
    assert doc["image_base64s"] == [PNG] and "image_keys" not in doc
    assert client.get(f"/api/invoices/{made['id']}", headers=owner).json()["image_base64s"] == [PNG]
    assert asyncio.run(photo_store.move_invoice_photos(server.db)) == 0
