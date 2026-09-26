"""Web Push delivery (browser notifications), independent of any request
context - takes plain dicts/strings in, never touches server.py's User model
or permission logic, so it can be imported without a circular dependency.

Requires VAPID_PRIVATE_KEY (a base64url-encoded raw EC private key, e.g. the
output of `openssl`/`py_vapid`'s `Vapid.generate_keys()`) as an environment
variable. Without it, every send is a silent no-op (logged once) so a
missing/misconfigured key degrades gracefully instead of crashing requests
that happen to trigger a notification.
"""
import asyncio
import json
import logging
import os
from typing import Any, Dict, Iterable, Optional

from pywebpush import WebPushException, webpush

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:support@fakturaplus.app")

_warned_unconfigured = False


def is_configured() -> bool:
    return bool(VAPID_PRIVATE_KEY)


def _warn_unconfigured_once():
    global _warned_unconfigured
    if not _warned_unconfigured:
        logger.warning("VAPID_PRIVATE_KEY not set - push notifications are disabled.")
        _warned_unconfigured = True


def _send_sync(subscription_info: Dict[str, Any], payload_json: str) -> Optional[int]:
    """Runs pywebpush's (blocking) send. Returns an HTTP status code worth
    acting on (404/410 -> the subscription is dead and should be deleted),
    or None for success or a non-actionable error (already logged here).

    pywebpush only wraps push-service-protocol errors in WebPushException -
    a dead endpoint, DNS failure or timeout raises requests' own exceptions
    straight through. A single unreachable subscription must never take
    down the caller (a chat reply the sender is waiting on, or the
    reminder loop's whole tick), so every delivery failure is caught here."""
    try:
        webpush(
            subscription_info=subscription_info,
            data=payload_json,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=12 * 60 * 60,
        )
        return None
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status not in (404, 410):
            logger.warning(f"Web push delivery failed: {exc}")
        return status
    except Exception as exc:
        logger.warning(f"Web push delivery failed (network/transport error): {exc}")
        return None


async def send_to_subscription(db, subscription_doc: Dict[str, Any], title: str, body: str, data: Optional[dict] = None):
    if not is_configured():
        _warn_unconfigured_once()
        return
    payload = json.dumps({"title": title, "body": body, "data": data or {}})
    subscription_info = {"endpoint": subscription_doc["endpoint"], "keys": subscription_doc["keys"]}
    status = await asyncio.to_thread(_send_sync, subscription_info, payload)
    if status in (404, 410):
        await db.push_subscriptions.delete_one({"endpoint": subscription_doc["endpoint"]})


async def send_to_user(db, user_id: str, title: str, body: str, data: Optional[dict] = None):
    if not is_configured():
        _warn_unconfigured_once()
        return
    subscriptions = await db.push_subscriptions.find({"user_id": user_id}, {"_id": 0}).to_list(20)
    for sub in subscriptions:
        await send_to_subscription(db, sub, title, body, data)


async def send_to_users(db, user_ids: Iterable[str], title: str, body: str, data: Optional[dict] = None):
    for user_id in user_ids:
        await send_to_user(db, user_id, title, body, data)
