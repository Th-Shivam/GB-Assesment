from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import fsum, sqrt

from app.core.policy import DecisionPolicy, DeliveryRange
from app.schemas.analytics import ComparisonPoint, Metrics, Quality
from app.schemas.source import ActualRecord, ForecastRecord, SourceRecord


@dataclass
class Version:
    record: SourceRecord
    conflicting: bool = False
    duplicate_rows: int = 0


def versions(rows: Iterable[SourceRecord]) -> dict[datetime, list[Version]]:
    """Collapse exact repeats; a conflicting key is never resolved by input order."""
    by_key: dict[tuple[datetime, datetime], Version] = {}
    seen: set[SourceRecord] = set()
    for row in rows:
        key = (row.start_time, row.publish_time)
        if key not in by_key:
            by_key[key] = Version(row)
        elif row in seen:
            by_key[key].duplicate_rows += 1
        else:
            by_key[key].conflicting = True
        seen.add(row)
    by_target: dict[datetime, list[Version]] = defaultdict(list)
    for value in by_key.values():
        by_target[value.record.start_time].append(value)
    for items in by_target.values():
        items.sort(key=lambda item: item.record.publish_time)
    return dict(by_target)


def value(version: Version | None, label: str) -> tuple[int | None, list[str]]:
    if version is None:
        return None, [f"missing_{label}"]
    if version.conflicting:
        return None, [f"conflicting_{label}"]
    if version.record.generation is None:
        return None, [f"null_{label}"]
    generation = version.record.generation
    return generation, [f"negative_{label}"] if generation < 0 else []


def latest_eligible(
    items: list[Version], policy: DecisionPolicy, target: datetime
) -> Version | None:
    return next(
        (item for item in reversed(items) if policy.eligible(item.record.publish_time, target)),
        None,
    )


def compare(
    window: DeliveryRange,
    policy: DecisionPolicy,
    actual_rows: Iterable[ActualRecord],
    forecast_rows: Iterable[ForecastRecord],
) -> tuple[list[ComparisonPoint], Quality]:
    actuals = versions(
        r
        for r in actual_rows
        if r.fuel_type == "WIND" and window.start <= r.start_time < window.end
    )
    forecasts = versions(r for r in forecast_rows if window.start <= r.start_time < window.end)
    points = []
    usable_half_hours = 0
    for target in window.hours():
        actual_versions = [
            actuals[t][-1] if actuals.get(t) else None
            for t in (target, target + timedelta(minutes=30))
        ]
        half_values: list[int | None] = []
        issues: list[str] = []
        for item in actual_versions:
            generation, problems = value(item, "actual")
            half_values.append(generation)
            issues.extend(problems)
            usable_half_hours += generation is not None
        left, right = half_values
        actual = (left + right) / 2 if left is not None and right is not None else None
        selected = latest_eligible(forecasts.get(target, []), policy, target)
        forecast, problems = value(selected, "forecast")
        issues.extend(problems)
        pair = actual is not None and forecast is not None
        evaluated = pair and policy.comparison_mode == "hourly_average_assumption"
        if policy.comparison_mode == "unverified":
            issues.append("forecast_semantics_unverified")
        published = selected.record.publish_time if selected else None
        cutoff = policy.cutoff(target)
        error = (
            forecast - actual if evaluated and forecast is not None and actual is not None else None
        )
        percentage = 100 * error / actual if error is not None and actual and actual > 0 else None
        points.append(
            ComparisonPoint(
                start_time=target,
                end_time=target + timedelta(hours=1),
                decision_cutoff=cutoff,
                actual_mw=actual,
                actual_half_hour_mw=half_values,
                actual_publish_times=[
                    v.record.publish_time if v else None for v in actual_versions
                ],
                forecast_mw=forecast,
                forecast_publish_time=published,
                forecast_age_at_decision_hours=(cutoff - published).total_seconds() / 3600
                if published
                else None,
                forecast_horizon_hours=(target - published).total_seconds() / 3600
                if published
                else None,
                pair_available=pair,
                evaluated=evaluated,
                issues=sorted(set(issues)),
                signed_error_mw=error,
                absolute_error_mw=abs(error) if error is not None else None,
                signed_percentage_error=percentage,
                absolute_percentage_error=abs(percentage) if percentage is not None else None,
            )
        )
    a_versions = [v for group in actuals.values() for v in group]
    f_versions = [v for group in forecasts.values() for v in group]
    pairs = sum(p.pair_available for p in points)
    excluded = Counter(issue for p in points if not p.evaluated for issue in p.issues)
    return points, Quality(
        expected_half_hours=len(points) * 2,
        usable_actual_half_hours=usable_half_hours,
        expected_hours=len(points),
        usable_actual_hours=sum(p.actual_mw is not None for p in points),
        usable_forecast_hours=sum(p.forecast_mw is not None for p in points),
        available_pairs=pairs,
        evaluated_pairs=sum(p.evaluated for p in points),
        available_pair_coverage_percent=100 * pairs / len(points),
        actual_duplicate_rows=sum(v.duplicate_rows for v in a_versions),
        forecast_duplicate_rows=sum(v.duplicate_rows for v in f_versions),
        actual_conflicting_keys=sum(v.conflicting for v in a_versions),
        forecast_conflicting_keys=sum(v.conflicting for v in f_versions),
        excluded_by_reason=dict(excluded),
    )


def metrics(points: list[ComparisonPoint], policy: DecisionPolicy) -> Metrics:
    if policy.comparison_mode == "unverified":
        return Metrics(status="semantics_unverified", paired_count=0)
    paired = [p for p in points if p.evaluated]
    n = len(paired)
    if not n:
        return Metrics(status="no_valid_pairs", paired_count=0)
    errors = [p.signed_error_mw for p in paired if p.signed_error_mw is not None]
    absolute_sum = fsum(abs(e) for e in errors)
    denominator = fsum(abs(p.actual_mw) for p in paired if p.actual_mw is not None)
    percentages = [
        p.absolute_percentage_error for p in paired if p.absolute_percentage_error is not None
    ]
    return Metrics(
        status="available_under_assumption",
        paired_count=n,
        mae_mw=absolute_sum / n,
        rmse_mw=sqrt(fsum(e * e for e in errors) / n),
        signed_bias_mw=fsum(errors) / n,
        wape_percent=100 * absolute_sum / denominator if denominator else None,
        wape_denominator_absolute_actual_mw_sum=denominator,
        mape_positive_actual_percent=fsum(percentages) / len(percentages) if percentages else None,
        mape_positive_actual_count=len(percentages),
        percentage_excluded_nonpositive_actual_count=n - len(percentages),
        percentage_unavailable_reason="zero_total_absolute_actual"
        if denominator == 0
        else "no_positive_actuals"
        if not percentages
        else None,
    )
