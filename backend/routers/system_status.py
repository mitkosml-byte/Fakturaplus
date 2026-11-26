"""The program's state - the "Състояние" screen: whether the server, the
database and each background job work, which outside services are switched
on, and the errors of the last day (services/error_log).

The owner sees their own company's errors; the person who runs the program
(ADMIN_EMAIL) sees every company's, with the details.

Also takes the errors the app meets on a phone or in a browser, so they land
in the same log (POST /client-errors)."""
import time

from fastapi import APIRouter
from server import *
import server
from services import push_service

router = APIRouter(prefix="/api")

STARTED_AT = datetime.now(timezone.utc)
ERRORS_SHOWN = 50

_ID_LIKE = re.compile(r"[0-9a-f]{8,}|\d+", re.IGNORECASE)


class ClientErrorReport(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    stack: Optional[str] = Field(default=None, max_length=20000)
    # The screen's route as a template ("/supplier/[name]"), not its values.
    screen: Optional[str] = Field(default=None, max_length=300)
    kind: Literal["error", "promise", "render"] = "error"
    platform: Optional[Literal["web", "ios", "android"]] = None


@router.post("/client-errors", status_code=204)
@limiter.limit("30/minute")
async def report_client_error(request: Request, report: ClientErrorReport):
    user = await get_current_user_optional(request)
    screen = _ID_LIKE.sub("#", report.screen or "?")
    # "TypeError: x is undefined" - the kind once, the message after it.
    head, _, rest = report.message.partition(":")
    named = bool(rest.strip()) and len(head) <= 60 and " " not in head.strip()
    kind = head.strip() if named else report.kind
    message = rest.strip() if named else report.message
    await error_log.record(
        server.db,
        source="app",
        where=f"{report.platform or 'app'} {screen}",
        kind=kind,
        message=message,
        trace=report.stack,
        company_id=user.company_id if user else None,
        user_id=user.user_id if user else None,
        path=report.screen,
    )
    return Response(status_code=204)


def _utc(value: Any) -> Any:
    """The database gives times back without their zone; they are UTC -
    said so, or a phone reads them as its own local time."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _database_check() -> Dict[str, Any]:
    started = time.perf_counter()
    try:
        await server.db.command("ping")
    except Exception:
        return {"ok": False, "ms": None}
    return {"ok": True, "ms": round((time.perf_counter() - started) * 1000)}


@router.get("/system/status")
async def system_status(current_user: User = Depends(get_current_user)):
    admin = is_app_admin(current_user.email)
    if not admin and current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Състоянието на програмата вижда собственикът")
    now = datetime.now(timezone.utc)

    job_docs = {doc["key"]: doc for doc in await server.db.job_status.find({}, {"_id": 0}).to_list(100)}
    jobs = []
    for key, every_seconds in JOB_INTERVALS.items():
        # The monthly copy by email runs only with email switched on.
        enabled = key != "backup_email" or EMAIL_FEATURES_ENABLED
        doc = job_docs.get(key) or {}
        jobs.append({
            "key": key,
            "every_minutes": every_seconds // 60,
            "state": error_log.job_state(doc, every_seconds, enabled, now),
            "last_run_at": _utc(doc.get("last_run_at")),
            "last_ok_at": _utc(doc.get("last_ok_at")),
            "last_error_at": _utc(doc.get("last_error_at")),
            # What went wrong can name another company: for the admin only.
            "last_error": doc.get("last_error") if admin else None,
        })

    query: Dict[str, Any] = {"last_at": {"$gte": now - timedelta(hours=24)}}
    if not admin:
        query["company_id"] = current_user.company_id
    projection = {"_id": 0, "expires_at": 0, "fingerprint": 0, "user_id": 0}
    if not admin:
        projection["trace"] = 0
    errors = await server.db.error_log.find(query, projection).sort("last_at", -1).to_list(ERRORS_SHOWN)
    for e in errors:
        e["first_at"], e["last_at"] = _utc(e.get("first_at")), _utc(e.get("last_at"))
    if admin:
        ids = sorted({e["company_id"] for e in errors if e.get("company_id")})
        names = {
            c["id"]: c.get("name")
            for c in await server.db.companies.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(ids) or 1)
        }
        for e in errors:
            e["company_name"] = names.get(e.get("company_id"))

    return {
        "scope": "all" if admin else "company",
        "checked_at": now,
        "server": {
            "started_at": STARTED_AT,
            "version": (os.environ.get("RENDER_GIT_COMMIT") or "")[:7] or None,
        },
        "database": await _database_check(),
        "features": {
            "ai": AI_FEATURES_ENABLED,
            "email": EMAIL_FEATURES_ENABLED,
            "payments": BILLING_ENABLED,
            "push": push_service.is_configured(),
            "storage": object_storage.enabled(),
        },
        "jobs": jobs,
        "errors": {
            "count": sum(int(e.get("count") or 0) for e in errors),
            "items": errors,
        },
    }
