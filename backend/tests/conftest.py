"""Shared pytest fixtures for the backend test suite.

Swaps the app's MongoDB connection for an in-memory mongomock instance
before any test runs, so the suite needs no real database and never
touches production data. Run with: `pytest` from the `backend/` directory
(or `pytest backend/tests` from the repo root).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

import server


@pytest.fixture(scope="session", autouse=True)
def _mock_database():
    """Point the app at an isolated in-memory database for the whole
    test session. audit_service/forecast_service each captured the real
    db object at import time (before this fixture runs), so they need to
    be repointed too, or any action that logs an audit entry or reads a
    forecast tries to reach a real MongoDB that isn't there."""
    server.db = AsyncMongoMockClient()["test_db"]
    server.audit_service.db = server.db
    server.forecast_service.db = server.db
    server.scan_credit_service.db = server.db
    server.AI_FEATURES_ENABLED = False
    yield


@pytest.fixture(scope="session")
def client():
    with TestClient(server.app) as c:
        yield c


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
