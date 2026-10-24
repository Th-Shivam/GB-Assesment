"""Deliberately synthetic fixtures; not captured Elexon observations."""

from datetime import datetime, timedelta

from app.core.policy import LONDON, midnight
from app.schemas.source import ActualRecord, ForecastRecord


def instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def actual(
    target: str | datetime = "2026-01-01T00:00:00Z",
    generation: int | None = 100,
    *,
    publish: str | None = None,
    fuel: str = "WIND",
) -> ActualRecord:
    start = instant(target) if isinstance(target, str) else target
    day = start.astimezone(LONDON).date()
    return ActualRecord(
        dataset="FUELHH",
        startTime=start,
        publishTime=instant(publish) if publish else start + timedelta(minutes=30),
        generation=generation,
        fuelType=fuel,
        settlementDate=day,
        settlementPeriod=int((start - midnight(day)).total_seconds() / 1800) + 1,
    )


def forecast(
    target: str | datetime = "2026-01-01T00:00:00Z",
    generation: int | None = 120,
    publish: str = "2025-12-31T09:30:00Z",
) -> ForecastRecord:
    return ForecastRecord(
        dataset="WINDFOR",
        startTime=instant(target) if isinstance(target, str) else target,
        generation=generation,
        publishTime=instant(publish),
    )


def payload(row):
    return row.model_dump(mode="json", by_alias=True)
