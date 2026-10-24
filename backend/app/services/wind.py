import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from app.core.config import Settings
from app.core.policy import GATES, LONDON, DecisionPolicy, DeliveryRange
from app.schemas.analytics import (
    DailyErrors,
    ErrorAnalysisResponse,
    HistoryResponse,
    Metadata,
    Publication,
    SeriesResponse,
    SummaryResponse,
)
from app.services.analysis import compare, latest_eligible, metrics, versions
from app.services.elexon import Batch, ElexonClient


@dataclass(frozen=True)
class Snapshot:
    batches: list[Batch]
    publication_start: datetime
    publication_end: datetime


def days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


class WindService:
    def __init__(self, client: ElexonClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def load(self, window: DeliveryRange, *, history: bool = False) -> Snapshot:
        first = window.start_date - timedelta(days=self.settings.lookback_days)
        # Analysis needs all D-1 publications. History also shows hindsight runs on D.
        last = window.end_date if history else window.end_date - timedelta(days=1)
        requests = [self.client.day("WINDFOR", day) for day in days(first, last)]
        if not history:
            requests += [
                self.client.day("FUELHH", day) for day in days(window.start_date, window.end_date)
            ]
        results = await asyncio.gather(*requests, return_exceptions=True)
        batches = []
        for result in results:
            if isinstance(result, BaseException):
                raise result
            batches.append(result)
        return Snapshot(
            batches=batches,
            publication_start=datetime.combine(first, datetime.min.time(), UTC),
            publication_end=datetime.combine(last + timedelta(days=1), datetime.min.time(), UTC),
        )

    def metadata(
        self, window: DeliveryRange, policy: DecisionPolicy, snapshot: Snapshot
    ) -> Metadata:
        warnings = [
            "Market gate closure is a scenario default, not a required procurement time.",
            "publishTime reconstructs published records, not trader receipt or executable trades.",
            "WINDFOR hourly MW averaging semantics remain unverified; hourly cadence is not proof.",
            "Only the returned, bounded publication history is searched; no retention guarantee.",
            "Source update schedules differ from observed timestamps; timestamps are not shifted.",
            "HTTPX cannot verify unadvertised HTTP error trailers; complete parsing and coverage "
            "checks do not prove upstream historical completeness.",
        ]
        if policy.comparison_mode == "hourly_average_assumption":
            warnings.append(
                "Conditional scores: WINDFOR is explicitly assumed to be mean MW over [t,t+1h). "
                "Actual MW averages both FUELHH half-hours; no forecast is duplicated/interpolated."
            )
        else:
            warnings.append(
                "Accuracy metrics are withheld until hourly_average_assumption is selected."
            )
        return Metadata(
            delivery_start=window.start,
            delivery_end_exclusive=window.end,
            market=policy.market,
            market_gate_time=GATES.get(policy.market),
            internal_decision_time=policy.decision_time,
            effective_decision_time=policy.clock,
            cutoff_inclusive=policy.cutoff_inclusive,
            comparison_mode=policy.comparison_mode,
            publication_search_start=snapshot.publication_start,
            publication_search_end=snapshot.publication_end,
            warnings=warnings,
            fetches=[batch.provenance for batch in snapshot.batches],
        )

    async def series(self, window: DeliveryRange, policy: DecisionPolicy) -> SeriesResponse:
        snapshot = await self.load(window)
        points, quality = compare(
            window,
            policy,
            (row for batch in snapshot.batches for row in batch.actuals),
            (row for batch in snapshot.batches for row in batch.forecasts),
        )
        return SeriesResponse(
            metadata=self.metadata(window, policy, snapshot),
            quality=quality,
            metrics=metrics(points, policy),
            data=points,
        )

    async def summary(self, window: DeliveryRange, policy: DecisionPolicy) -> SummaryResponse:
        series = await self.series(window, policy)
        return SummaryResponse(
            metadata=series.metadata, quality=series.quality, metrics=series.metrics
        )

    async def errors(self, window: DeliveryRange, policy: DecisionPolicy) -> ErrorAnalysisResponse:
        series = await self.series(window, policy)
        grouped = defaultdict(list)
        for point in series.data:
            grouped[point.start_time.astimezone(LONDON).date()].append(point)
        worst = sorted(
            (p for p in series.data if p.evaluated),
            key=lambda p: (-(p.absolute_error_mw or 0), p.start_time),
        )[:10]
        return ErrorAnalysisResponse(
            metadata=series.metadata,
            quality=series.quality,
            metrics=series.metrics,
            by_day=[
                DailyErrors(
                    delivery_date=day,
                    expected_hours=len(points),
                    available_pairs=sum(p.pair_available for p in points),
                    metrics=metrics(points, policy),
                )
                for day, points in grouped.items()
            ],
            largest_absolute_errors=worst,
        )

    async def history(self, target: datetime, policy: DecisionPolicy) -> HistoryResponse:
        target = target.astimezone(UTC)
        day = target.astimezone(LONDON).date()
        window = DeliveryRange(start_date=day, end_date=day)
        snapshot = await self.load(window, history=True)
        grouped = versions(
            row for batch in snapshot.batches for row in batch.forecasts if row.start_time == target
        )
        items = grouped.get(target, [])
        selected = latest_eligible(items, policy, target)
        publications = []
        for item in items:
            issues = []
            if item.conflicting:
                issues.append("conflicting_forecast")
            elif item.record.generation is None:
                issues.append("null_forecast")
            elif item.record.generation < 0:
                issues.append("negative_forecast")
            publications.append(
                Publication(
                    start_time=target,
                    publish_time=item.record.publish_time,
                    generation_mw=None if item.conflicting else item.record.generation,
                    eligible=policy.eligible(item.record.publish_time, target),
                    selected=item is selected,
                    conflicting=item.conflicting,
                    duplicate_rows=item.duplicate_rows,
                    issues=issues,
                )
            )
        return HistoryResponse(
            metadata=self.metadata(window, policy, snapshot),
            target=target,
            decision_cutoff=policy.cutoff(target),
            status="available" if publications else "empty",
            data=publications,
        )
