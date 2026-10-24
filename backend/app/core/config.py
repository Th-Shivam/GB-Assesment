from typing import Annotated, Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

Market = Literal["n2ex", "epex", "custom"]
ComparisonMode = Literal["unverified", "hourly_average_assumption"]
Clock = Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WIND_", env_file=".env", extra="ignore")

    default_market: Literal["n2ex", "epex"] = "n2ex"
    internal_decision_time: Clock | None = None
    cutoff_inclusive: bool = True
    comparison_mode: ComparisonMode = "unverified"
    lookback_days: int = Field(default=3, ge=1, le=14)
    cache_ttl_seconds: float = Field(default=3600, ge=0, le=86400)
    cache_max_entries: int = Field(default=128, ge=1, le=512)
    upstream_timeout_seconds: float = Field(default=30, gt=0, le=120)
    upstream_concurrency: int = Field(default=4, ge=1, le=8)
    upstream_retries: int = Field(default=3, ge=0, le=5)
    max_retry_wait_seconds: float = Field(default=30, ge=0, le=120)
