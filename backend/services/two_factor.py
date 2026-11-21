"""A second step at login: a 6-digit code from an authenticator app (TOTP,
RFC 6238 - Google Authenticator, Microsoft Authenticator, Authy...), or one
sent by email, and one-time recovery codes for a lost phone.

Codes are compared in constant time; a code of the app is good once (the
last time step used is kept), and recovery and email codes are kept only
as hashes."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from typing import List, Optional
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
ISSUER = "Фактура+"
RECOVERY_CODES = 8
_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I


def new_secret() -> str:
    """A fresh shared secret for an authenticator app (base32, 160 bits)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key(secret: str) -> bytes:
    clean = secret.strip().replace(" ", "").upper()
    return base64.b32decode(clean + "=" * (-len(clean) % 8))


def code_at(secret: str, counter: int) -> str:
    """The code of a time step (RFC 4226 HOTP over the step number)."""
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** DIGITS)).zfill(DIGITS)


def current_step(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // STEP_SECONDS)


def normalize(code: str) -> str:
    return "".join(ch for ch in str(code or "") if ch.isalnum()).upper()


def verify_app_code(secret: str, code: str, last_step: Optional[int] = None,
                    now: Optional[float] = None, window: int = 1) -> Optional[int]:
    """The time step a code of the app is for - if it is right, within a
    step either way (a phone's clock a little off), and not used before;
    else None."""
    typed = normalize(code)
    if len(typed) != DIGITS or not typed.isdigit():
        return None
    step = current_step(now)
    for candidate in range(step - window, step + window + 1):
        if last_step is not None and candidate <= last_step:
            continue
        if hmac.compare_digest(code_at(secret, candidate), typed):
            return candidate
    return None


def otpauth_uri(secret: str, account: str) -> str:
    """What an authenticator app reads (as a link or a QR code)."""
    label = quote(f"{ISSUER}:{account}")
    return (f"otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}"
            f"&digits={DIGITS}&period={STEP_SECONDS}&algorithm=SHA1")


def hash_code(code: str) -> str:
    return hashlib.sha256(normalize(code).encode("utf-8")).hexdigest()


def new_recovery_codes() -> List[str]:
    """One-time codes to get in without the phone, shown once ("XXXX-XXXX")."""
    def one() -> str:
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(8))
        return f"{raw[:4]}-{raw[4:]}"
    return [one() for _ in range(RECOVERY_CODES)]


def new_email_code() -> str:
    return f"{secrets.randbelow(10 ** DIGITS):0{DIGITS}d}"


def matches_hash(code: str, hashed: Optional[str]) -> bool:
    return bool(hashed) and hmac.compare_digest(hash_code(code), str(hashed))
