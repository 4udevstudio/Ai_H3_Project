"""Pytest fixtures. Environment paths are configured before the app import."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import tests.paths  # noqa: F401  (sets OUTPUTS_DIR before app import)
from app.main import app
from app.services.export_service import export_service
from app.services.queue_service import queue_service


def _reset_jobs() -> None:
    with queue_service._lock:
        queue_service._jobs.clear()
    export_service.reset()


@pytest.fixture
def api():
    _reset_jobs()
    with TestClient(app) as client:
        yield client
    _reset_jobs()
