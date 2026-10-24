from datetime import UTC, date, datetime, time, timedelta
from typing import Self
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.config import Clock, ComparisonMode, Market

LONDON = ZoneInfo("Europe/London")
MONTH_START = date(2026, 1, 1)
MONTH_END = date(2026, 1, 31)
GATES = {"n2ex": "09:50", "epex": "09:20"}


def midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, LONDON).astimezone(UTC)


class DeliveryRange(BaseModel):
    model_config = ConfigDict(frozen=True)
    start_date: date = MONTH_START
    end_date: date = MONTH_END

    @model_validator(mode="after")
    def valid_range(self) -> Self:
        if not MONTH_START <= self.start_date <= self.end_date <= MONTH_END:
            raise ValueError("Delivery dates must be ordered and within January 2026.")
        return self

    @property
    def start(self) -> datetime:
        return midnight(self.start_date)

    @property
    def end(self) -> datetime:
        return midnight(self.end_date + timedelta(days=1))

    def hours(self) -> list[datetime]:
        count = int((self.end - self.start).total_seconds() // 3600)
        return [self.start + timedelta(hours=i) for i in range(count)]


class DecisionPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)
    market: Market = "n2ex"
    decision_time: Clock | None = None
    cutoff_inclusive: bool = True
    comparison_mode: ComparisonMode = "unverified"

    @model_validator(mode="after")
    def valid_decision(self) -> Self:
        if self.market == "custom" and self.decision_time is None:
            raise ValueError("A custom scenario requires decision_time (HH:MM UK time).")
        gate = GATES.get(self.market)
        if gate and self.decision_time and self.decision_time > gate:
            raise ValueError("An internal decision time cannot be later than the market gate.")
        return self

    @property
    def clock(self) -> str:
        return self.decision_time or GATES[self.market]

    def cutoff(self, target: datetime) -> datetime:
        day = target.astimezone(LONDON).date() - timedelta(days=1)
        return datetime.combine(day, time.fromisoformat(self.clock), LONDON).astimezone(UTC)

    def eligible(self, published: datetime, target: datetime) -> bool:
        cutoff = self.cutoff(target)
        before = published <= cutoff if self.cutoff_inclusive else published < cutoff
        return before and published < target
