"""A backup locked with a password (P1-3): the monthly backup by email holds
everything - salaries, people, pocket money, the personal notebook - so
whoever gets into the mailbox must not be able to read it.

The file: b"FPBAK1", a 16-byte salt, a 12-byte nonce, then the gzip-ed
backup sealed with AES-256-GCM. The key comes from the password with
scrypt. The server keeps the key (never the password) to lock each month's
file; opening one takes the password again. The app restores it from the
"Архив" screen, as it does a plain or a gzip-ed file.
"""
from __future__ import annotations

import base64
import json
import os
import zlib
from typing import Any, Dict, Optional, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"FPBAK1"
SALT_BYTES = 16
NONCE_BYTES = 12
MIN_PASSWORD = 8
# A backup opened from a file is at most this big once unpacked: a small
# file that unpacks into gigabytes stops here.
MAX_UNPACKED_BYTES = 300 * 1024 * 1024


class NotABackup(ValueError):
    pass


class PasswordNeeded(ValueError):
    pass


class WrongPassword(ValueError):
    pass


def derive_key(password: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2 ** 15, r=8, p=1).derive(password.encode("utf-8"))


def new_key(password: str) -> Tuple[bytes, bytes]:
    """A fresh salt and the key from the password with it."""
    salt = os.urandom(SALT_BYTES)
    return salt, derive_key(password, salt)


def to_text(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def from_text(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def seal(data: bytes, key: bytes, salt: bytes) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return MAGIC + salt + nonce + AESGCM(key).encrypt(nonce, data, MAGIC)


def is_sealed(blob: bytes) -> bool:
    return blob.startswith(MAGIC)


def unseal(blob: bytes, password: str) -> bytes:
    head = len(MAGIC)
    salt = blob[head:head + SALT_BYTES]
    nonce = blob[head + SALT_BYTES:head + SALT_BYTES + NONCE_BYTES]
    body = blob[head + SALT_BYTES + NONCE_BYTES:]
    if len(salt) != SALT_BYTES or len(nonce) != NONCE_BYTES or not body:
        raise NotABackup("broken file")
    try:
        return AESGCM(derive_key(password, salt)).decrypt(nonce, body, MAGIC)
    except InvalidTag:
        raise WrongPassword("wrong password")


def gunzip(blob: bytes) -> bytes:
    unpacker = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        out = unpacker.decompress(blob, MAX_UNPACKED_BYTES)
    except zlib.error:
        raise NotABackup("broken gzip")
    if unpacker.unconsumed_tail:
        raise NotABackup("too big")
    return out


def pack(backup: Dict[str, Any]) -> bytes:
    """The backup as gzip-ed JSON - the same as one made by hand, packed."""
    import gzip
    return gzip.compress(json.dumps(backup, ensure_ascii=False, default=str).encode("utf-8"))


def read_backup(blob: bytes, password: Optional[str] = None) -> Dict[str, Any]:
    """A backup from a file: plain JSON, gzip-ed JSON, or locked with a
    password."""
    if is_sealed(blob):
        if not password:
            raise PasswordNeeded("password needed")
        blob = unseal(blob, password)
    if blob[:2] == b"\x1f\x8b":
        blob = gunzip(blob)
    try:
        data = json.loads(blob.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise NotABackup("not JSON")
    if not isinstance(data, dict):
        raise NotABackup("not a backup")
    return data
