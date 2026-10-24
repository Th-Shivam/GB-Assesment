from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

from app.core.policy import LONDON, midnight

Generation = Annotated[StrictInt, Field(ge=-(2**63), lt=2**63)]


class SourceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, frozen=True)

    start_time: AwareDatetime = Field(alias="startTime")
    publish_time: AwareDatetime = Field(alias="publishTime")
    generation: Generation | None

    @field_validator("start_time", "publish_time")
    @classmethod
    def utc(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)


class ActualRecord(SourceRecord):
    dataset: Literal["FUELHH"]
    fuel_type: str = Field(alias="fuelType")
    settlement_date: date = Field(alias="settlementDate")
    settlement_period: StrictInt = Field(alias="settlementPeriod")

    @model_validator(mode="after")
    def settlement_matches(self) -> Self:
        local = self.start_time.astimezone(LONDON)
        expected = int((self.start_time - midnight(local.date())).total_seconds() // 1800) + 1
        if (
            local.date() != self.settlement_date
            or expected != self.settlement_period
            or self.start_time.minute not in (0, 30)
            or self.start_time.second
            or self.start_time.microsecond
        ):
            raise ValueError("FUELHH timestamp and settlement metadata disagree.")
        return self


class ForecastRecord(SourceRecord):
    dataset: Literal["WINDFOR"]

    @model_validator(mode="after")
    def hourly_target(self) -> Self:
        if self.start_time.minute or self.start_time.second or self.start_time.microsecond:
            raise ValueError("WINDFOR target cadence changed; expected whole UTC hours.")
        return self
