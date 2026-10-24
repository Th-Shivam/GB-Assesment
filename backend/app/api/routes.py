from datetime import UTC
from typing import Annotated, Self, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError, model_validator

from app.core.config import Clock, ComparisonMode, Market, Settings
from app.core.policy import MONTH_END, MONTH_START, DecisionPolicy, DeliveryRange
from app.schemas.analytics import (
    ErrorAnalysisResponse,
    ErrorResponse,
    Health,
    HistoryResponse,
    SeriesResponse,
    SummaryResponse,
)
from app.services.wind import WindService

router = APIRouter(
    responses={
        502: {
            "model": ErrorResponse,
            "description": "Upstream rejection, transport or schema failure",
        },
        503: {"model": ErrorResponse, "description": "Upstream rate limited"},
        504: {"model": ErrorResponse, "description": "Upstream timeout"},
    }
)


class PolicyQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    market: Market | None = None
    decision_time: Clock | None = None
    cutoff_inclusive: bool | None = None
    comparison_mode: ComparisonMode | None = None

    def policy(self, settings: Settings) -> DecisionPolicy:
        try:
            return DecisionPolicy(
                market=self.market or settings.default_market,
                decision_time=self.decision_time
                if self.decision_time is not None
                else settings.internal_decision_time,
                cutoff_inclusive=self.cutoff_inclusive
                if self.cutoff_inclusive is not None
                else settings.cutoff_inclusive,
                comparison_mode=self.comparison_mode or settings.comparison_mode,
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc.errors()[0]["msg"])) from exc


class AnalysisQuery(PolicyQuery, DeliveryRange):
    pass


class HistoryQuery(PolicyQuery):
    target: AwareDatetime

    @model_validator(mode="after")
    def valid_target(self) -> Self:
        target = self.target.astimezone(UTC)
        if not MONTH_START <= target.date() <= MONTH_END:
            raise ValueError("Target must be within January 2026.")
        if target.minute or target.second or target.microsecond:
            raise ValueError("WINDFOR history requires a whole-hour UTC target.")
        return self


def service(request: Request) -> WindService:
    return cast(WindService, request.app.state.wind)


Service = Annotated[WindService, Depends(service)]


@router.get("/health", response_model=Health, tags=["health"])
async def health() -> Health:
    """Process liveness only; does not claim upstream connectivity or data completeness."""
    return Health()


@router.get("/api/v1/wind/summary", response_model=SummaryResponse, tags=["wind"])
async def summary(query: Annotated[AnalysisQuery, Query()], wind: Service) -> SummaryResponse:
    """January coverage and metrics. Scores require explicit hourly-average assumption."""
    window = DeliveryRange(start_date=query.start_date, end_date=query.end_date)
    return await wind.summary(window, query.policy(wind.settings))


@router.get("/api/v1/wind/series", response_model=SeriesResponse, tags=["wind"])
async def series(query: Annotated[AnalysisQuery, Query()], wind: Service) -> SeriesResponse:
    """One row per hour; both constituent actual half-hours remain visible."""
    window = DeliveryRange(start_date=query.start_date, end_date=query.end_date)
    return await wind.series(window, query.policy(wind.settings))


@router.get("/api/v1/wind/errors", response_model=ErrorAnalysisResponse, tags=["wind"])
async def errors(query: Annotated[AnalysisQuery, Query()], wind: Service) -> ErrorAnalysisResponse:
    """Daily metrics and the ten largest absolute errors, never filled missing values."""
    window = DeliveryRange(start_date=query.start_date, end_date=query.end_date)
    return await wind.errors(window, query.policy(wind.settings))


@router.get("/api/v1/wind/publications", response_model=HistoryResponse, tags=["wind"])
async def publications(query: Annotated[HistoryQuery, Query()], wind: Service) -> HistoryResponse:
    """Bounded publication history, including explicitly ineligible post-cutoff records."""
    return await wind.history(query.target, query.policy(wind.settings))
