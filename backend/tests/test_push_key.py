"""The browser subscribes to pushes with the public half of the server's
own VAPID key, served by the server (plug and play: a new install with its
own keys needs no change in the app)."""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid

from services import push_service
from tests.test_whole_program_fixes import _company


def test_the_public_key_comes_from_the_servers_own_key(client, monkeypatch):
    _, _, owner = _company()
    vapid = Vapid()
    vapid.generate_keys()
    raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_KEY", base64.urlsafe_b64encode(raw).rstrip(b"=").decode())
    monkeypatch.setattr(push_service, "_public_key", None)
    expected = base64.urlsafe_b64encode(vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
    )).rstrip(b"=").decode()
    assert client.get("/api/push/public-key", headers=owner).json() == {"public_key": expected}


def test_without_a_key_there_is_none(client, monkeypatch):
    _, _, owner = _company()
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_KEY", None)
    monkeypatch.setattr(push_service, "_public_key", None)
    assert client.get("/api/push/public-key", headers=owner).json() == {"public_key": None}
