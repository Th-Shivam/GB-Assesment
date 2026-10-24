from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.config import Settings
from app.core.errors import UpstreamError
from app.core.policy import DecisionPolicy
from app.schemas.analytics import ErrorResponse
from app.services.elexon import ElexonClient
from app.services.wind import WindService


def create_app(
    settings: Settings | None = None, *, transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    config = settings or Settings()
    # Fail at startup for a contradictory configured market/internal deadline.
    DecisionPolicy(market=config.default_market, decision_time=config.internal_decision_time)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(
            transport=transport,
            headers={"Accept": "application/json", "User-Agent": "gb-wind-assessment/0.1"},
            timeout=config.upstream_timeout_seconds,
            limits=httpx.Limits(max_connections=config.upstream_concurrency),
            follow_redirects=False,
        ) as http:
            client = ElexonClient(http, config)
            app.state.wind = WindService(client, config)
            try:
                yield
            finally:
                await client.close()

    app = FastAPI(
        title="GB Wind Forecast Analytics",
        version="0.1.0",
        description=(
            "January 2026 FUELHH/WINDFOR analytics. Published-as-of reconstruction, not trader "
            "receipt evidence. Hourly-average accuracy requires an explicitly selected assumption."
        ),
        lifespan=lifespan,
    )

    @app.exception_handler(UpstreamError)
    async def upstream_error(request: Request, exc: UpstreamError) -> JSONResponse:
        headers = {"Cache-Control": "no-store"}
        if exc.retry_after is not None:
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse(
            status_code=exc.status,
            content=ErrorResponse(
                code=exc.code, message=str(exc), retry_after_seconds=exc.retry_after
            ).model_dump(),
            headers=headers,
        )

    app.include_router(router)
    return app


app = create_app()
