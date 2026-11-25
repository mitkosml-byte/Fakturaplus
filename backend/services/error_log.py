"""The program's own record of what went wrong, and of its background jobs.

Every unexpected error is written here: a request the server could not
answer, a background job that failed, an error a phone or a browser met in
the app. The same error on the same day in the same company is one record
with a count, so a job failing every ten minutes is one line, not a hundred.
Records go after KEEP_DAYS.

Each background job also writes down every run (job_status): when it last
ran, whether that went well, and the last failure. The "Състояние" screen
reads both.

Nothing here may raise: the error recorder failing must never turn an error
into a second one.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

KEEP_DAYS = 30
# What the app sends can come from anyone: at most this many new records a
# day, so a flood cannot fill the database. Errors already known still count.
APP_NEW_PER_DAY = 1000

MESSAGE_LIMIT = 500
TRACE_LIMIT = 4000

SOURCES = ("server", "job", "app")

_LONG_HEX = re.compile(r"\b[0-9a-f]{8,}\b", re.IGNORECASE)
_NUMBER = re.compile(r"\d+")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def fingerprint(source: str, where: str, kind: str, message: str) -> str:
    """The same error, whatever ids and numbers its message carries."""
    lines = (message or "").strip().splitlines()
    first = lines[0] if lines else ""
    first = _NUMBER.sub("#", _LONG_HEX.sub("#", first))[:200]
    return hashlib.sha1(f"{source}|{where}|{kind}|{first}".encode("utf-8")).hexdigest()[:16]


def trace_of(error: BaseException) -> str:
    """The end of the traceback: where it happened is at the bottom."""
    text = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    return text[-TRACE_LIMIT:]


async def record(
    db: Any,
    *,
    source: str,
    where: str,
    kind: str,
    message: str,
    trace: Optional[str] = None,
    company_id: Optional[str] = None,
    user_id: Optional[str] = None,
    path: Optional[str] = None,
) -> None:
    try:
        now = _now()
        day = now.date().isoformat()
        where = (where or "?")[:200]
        kind = (kind or "Error")[:100]
        message = (message or "")[:MESSAGE_LIMIT]
        key = {
            "fingerprint": fingerprint(source, where, kind, message),
            "day": day,
            "company_id": company_id,
        }
        if source == "app":
            known = await db.error_log.find_one(key, {"_id": 1})
            if not known and await db.error_log.count_documents({"day": day, "source": "app"}) >= APP_NEW_PER_DAY:
                return
        await db.error_log.update_one(
            key,
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "source": source,
                    "where": where,
                    "kind": kind,
                    "first_at": now,
                    "expires_at": now + timedelta(days=KEEP_DAYS),
                },
                "$set": {
                    "last_at": now,
                    "message": message,
                    "trace": (trace or "")[-TRACE_LIMIT:] or None,
                    "path": (path or "")[:300] or None,
                    "user_id": user_id,
                },
                "$inc": {"count": 1},
            },
            upsert=True,
        )
    except Exception:
        logger.exception("Could not write an error to the error log")


async def record_exception(db: Any, error: BaseException, *, source: str, where: str, **who: Any) -> None:
    await record(
        db, source=source, where=where, kind=type(error).__name__,
        message=str(error) or type(error).__name__, trace=trace_of(error), **who,
    )


async def _note_run(db: Any, key: str, every_seconds: int, started: datetime, error: Optional[BaseException]) -> None:
    try:
        finished = _now()
        fields: dict = {"key": key, "every_seconds": every_seconds, "last_run_at": started, "last_finished_at": finished}
        if error is None:
            fields["last_ok_at"] = finished
            fields["ok"] = True
        else:
            fields["last_error_at"] = finished
            fields["last_error"] = f"{type(error).__name__}: {error}"[:MESSAGE_LIMIT]
            fields["ok"] = False
        await db.job_status.update_one(
            {"key": key},
            {"$set": fields, "$inc": {"runs": 1, "failures": 0 if error is None else 1}},
            upsert=True,
        )
    except Exception:
        logger.exception("Could not write down a background job's run")


async def run_job(db: Any, key: str, tick: Callable[[], Awaitable[Any]], every_seconds: int) -> None:
    """A background job: tick now and then every `every_seconds`, writing
    down each run and recording any failure - a job never stops because
    one run failed."""
    while True:
        started = _now()
        failure: Optional[BaseException] = None
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            failure = error
            logger.error(f"Background job {key} failed: {error}")
            await record_exception(db, error, source="job", where=key)
        await _note_run(db, key, every_seconds, started, failure)
        await asyncio.sleep(every_seconds)


def job_state(doc: Optional[dict], every_seconds: int, enabled: bool, now: Optional[datetime] = None) -> str:
    """ok / failing / late / waiting / off for one job on the status screen."""
    if not enabled:
        return "off"
    if not doc or not doc.get("last_run_at"):
        return "waiting"
    now = now or _now()
    last_run = doc["last_run_at"]
    if last_run.tzinfo is None:
        last_run = last_run.replace(tzinfo=timezone.utc)
    # A run is late when two of its intervals and a few minutes went by.
    if now - last_run > timedelta(seconds=2 * every_seconds + 300):
        return "late"
    return "ok" if doc.get("ok", True) else "failing"
