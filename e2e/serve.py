"""The app for the browser checks: the server on an in-memory database and
the built web app, on one address - invented data only, nothing kept.

    python serve.py ../frontend/dist        (port 8010, or E2E_PORT)
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from fastapi.responses import FileResponse  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import server  # noqa: E402

server.db = AsyncMongoMockClient()["browser_checks"]
server.audit_service.db = server.db
server.forecast_service.db = server.db
server.scan_credit_service.db = server.db
# No outside services: no AI, no email, no second step required of the
# owner on the first day anyway.
server.AI_FEATURES_ENABLED = False
server.EMAIL_FEATURES_ENABLED = False
server.limiter.enabled = False

DIST = Path(sys.argv[1]).resolve()


@server.app.get("/{path:path}", include_in_schema=False)
async def web(path: str):
    target = (DIST / path).resolve()
    if path and target.is_file() and DIST in target.parents:
        return FileResponse(target)
    page = (DIST / f"{path}.html").resolve()
    if path and page.is_file() and DIST in page.parents:
        return FileResponse(page)
    return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(server.app, host="127.0.0.1", port=int(os.environ.get("E2E_PORT", "8010")), log_level="warning")
