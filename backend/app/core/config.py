from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator
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
    cors_origins: str = ""
    lookback_days: int = Field(default=3, ge=1, le=14)
    cache_ttl_seconds: float = Field(default=3600, ge=0, le=86400)
    cache_max_entries: int = Field(default=128, ge=1, le=512)
    upstream_timeout_seconds: float = Field(default=30, gt=0, le=120)
    upstream_concurrency: int = Field(default=4, ge=1, le=8)
    upstream_retries: int = Field(default=3, ge=0, le=5)
    max_retry_wait_seconds: float = Field(default=30, ge=0, le=120)

    @field_validator("cors_origins")
    @classmethod
    def normalize_cors_origins(cls, value: str) -> str:
        origins = []
        for item in value.split(","):
            origin = item.strip().rstrip("/")
            if not origin:
                continue
            parsed = urlsplit(origin)
            if (
                "*" in origin
                or parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    "CORS origins must be exact HTTP(S) origins without wildcards, "
                    "credentials, paths, queries, or fragments."
                )
            origins.append(origin)
        return ",".join(dict.fromkeys(origins))

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin for origin in self.cors_origins.split(",") if origin]
