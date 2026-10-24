from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import ComparisonMode, Market


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Health(Contract):
    status: Literal["ok"] = "ok"
    scope: Literal["process_liveness_only"] = "process_liveness_only"


class ErrorResponse(Contract):
    code: str
    message: str
    retry_after_seconds: int | None = None


class FetchProvenance(Contract):
    dataset: Literal["FUELHH", "WINDFOR"]
    native_resolution_minutes: Literal[30, 60]
    http_status: Literal[200] = 200
    request_url: str
    retrieved_at: datetime
    sha256: str
    received_rows: int
    accepted_rows: int
    cache_hit: bool = False


class Metadata(Contract):
    methodology_version: str = "2.0"
    source: Literal["Elexon BMRS"] = "Elexon BMRS"
    coverage_scope: str = "GB operationally visible wind; not all UK wind generation"
    delivery_start: datetime
    delivery_end_exclusive: datetime
    resolution_minutes: Literal[60] = 60
    units: Literal["MW"] = "MW"
    market: Market
    market_gate_time: str | None
    internal_decision_time: str | None
    effective_decision_time: str
    decision_timezone: str = "Europe/London"
    cutoff_inclusive: bool
    comparison_mode: ComparisonMode
    forecast_semantics_verified: Literal[False] = False
    publication_search_start: datetime
    publication_search_end: datetime
    retrieval_windows_complete: Literal[True] = True
    warnings: list[str]
    fetches: list[FetchProvenance]


class Quality(Contract):
    expected_half_hours: int
    usable_actual_half_hours: int
    expected_hours: int
    usable_actual_hours: int
    usable_forecast_hours: int
    available_pairs: int
    evaluated_pairs: int
    available_pair_coverage_percent: float
    actual_duplicate_rows: int
    forecast_duplicate_rows: int
    actual_conflicting_keys: int
    forecast_conflicting_keys: int
    excluded_by_reason: dict[str, int]


class Metrics(Contract):
    status: Literal["available_under_assumption", "semantics_unverified", "no_valid_pairs"]
    paired_count: int
    mae_mw: float | None = None
    rmse_mw: float | None = None
    signed_bias_mw: float | None = None
    wape_percent: float | None = None
    wape_denominator_absolute_actual_mw_sum: float = 0
    mape_positive_actual_percent: float | None = None
    mape_positive_actual_count: int = 0
    percentage_excluded_nonpositive_actual_count: int = 0
    percentage_unavailable_reason: str | None = None
    error_sign: Literal["forecast_minus_actual"] = "forecast_minus_actual"


class ComparisonPoint(Contract):
    start_time: datetime
    end_time: datetime
    decision_cutoff: datetime
    actual_mw: float | None
    actual_half_hour_mw: list[int | None]
    actual_publish_times: list[datetime | None]
    forecast_mw: int | None
    forecast_publish_time: datetime | None
    forecast_age_at_decision_hours: float | None
    forecast_horizon_hours: float | None
    pair_available: bool
    evaluated: bool
    issues: list[str]
    signed_error_mw: float | None = None
    absolute_error_mw: float | None = None
    signed_percentage_error: float | None = None
    absolute_percentage_error: float | None = None


class SummaryResponse(Contract):
    metadata: Metadata
    quality: Quality
    metrics: Metrics


class SeriesResponse(SummaryResponse):
    data: list[ComparisonPoint]


class DailyErrors(Contract):
    delivery_date: date
    expected_hours: int
    available_pairs: int
    metrics: Metrics


class ErrorAnalysisResponse(SummaryResponse):
    by_day: list[DailyErrors]
    largest_absolute_errors: list[ComparisonPoint]


class Publication(Contract):
    start_time: datetime
    publish_time: datetime
    generation_mw: int | None
    eligible: bool
    selected: bool
    conflicting: bool
    duplicate_rows: int
    issues: list[str] = Field(default_factory=list)


class HistoryResponse(Contract):
    metadata: Metadata
    target: datetime
    decision_cutoff: datetime
    status: Literal["available", "empty"]
    data: list[Publication]
