import os

import httpx
import pytest
from pydantic_settings import SettingsConfigDict

from app.core.config import Settings


class UnitSettings(Settings):
    # Test configuration never reads a developer's local .env file.
    model_config = SettingsConfigDict(env_prefix="WIND_", env_file=None, extra="ignore")


@pytest.fixture(autouse=True)
def isolate_environment_and_network(monkeypatch):
    for name in os.environ:
        if name.startswith("WIND_"):
            monkeypatch.delenv(name)

    async def no_network(*args, **kwargs):
        raise AssertionError("Unit tests must use MockTransport, never live network data.")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", no_network)


@pytest.fixture
def settings():
    return UnitSettings(max_retry_wait_seconds=0)
