from datetime import UTC, date, datetime, timedelta
from math import sqrt

import pytest
from pydantic import ValidationError

from app.core.policy import DecisionPolicy, DeliveryRange
from app.schemas.source import ActualRecord, ForecastRecord
from app.services.analysis import compare, metrics
from tests.factories import actual, forecast, instant, payload

DAY = DeliveryRange(start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))
ASSUMED = DecisionPolicy(comparison_mode="hourly_average_assumption")


def test_january_boundaries_and_final_half_hour():
    window = DeliveryRange()
    assert len(window.hours()) == 744
    assert window.start == instant("2026-01-01T00:00:00Z")
    assert window.end == instant("2026-02-01T00:00:00Z")
    last = window.hours()[-1]
    rows, quality = compare(
        window,
        ASSUMED,
        [actual(last, 60), actual(last + timedelta(minutes=30), 140)],
        [forecast(last, 90, "2026-01-30T09:30:00Z")],
    )
    assert quality.expected_half_hours == 1488
    assert rows[-1].actual_mw == 100
    assert rows[-1].actual_publish_times[-1] == window.end
    assert rows[-1].end_time == window.end
    assert rows[-1].signed_error_mw == -10


@pytest.mark.parametrize(
    "inclusive,offset,expected",
    [
        (True, -1, True),
        (True, 0, True),
        (True, 1, False),
        (False, -1, True),
        (False, 0, False),
        (False, 1, False),
    ],
)
def test_cutoff_boundary(inclusive, offset, expected):
    policy = DecisionPolicy(cutoff_inclusive=inclusive)
    target = instant("2026-01-01T23:00:00Z")
    cutoff = instant("2025-12-31T09:50:00Z")
    assert policy.cutoff(target) == cutoff
    assert policy.eligible(cutoff + timedelta(microseconds=offset), target) is expected


def test_epex_and_internal_decision_not_interchangeable():
    target = instant("2026-01-01T00:00:00Z")
    assert DecisionPolicy(market="epex").cutoff(target).hour == 9
    assert DecisionPolicy(market="epex").cutoff(target).minute == 20
    assert DecisionPolicy(decision_time="08:00").cutoff(target).hour == 8
    with pytest.raises(ValidationError):
        DecisionPolicy(market="epex", decision_time="09:30")
    with pytest.raises(ValidationError):
        DecisionPolicy(market="custom")
    assert DecisionPolicy(market="custom", decision_time="12:00").clock == "12:00"


@pytest.mark.parametrize(
    "target,expected",
    [
        ("2026-03-30T12:00:00Z", "2026-03-29T08:50:00Z"),
        ("2026-10-26T12:00:00Z", "2026-10-25T09:50:00Z"),
    ],
)
def test_policy_uses_uk_calendar_time_across_dst(target, expected):
    assert DecisionPolicy().cutoff(instant(target)) == instant(expected)


def test_latest_selected_per_target_unsorted_and_no_future_publications():
    forecasts = [
        forecast(generation=999, publish="2026-01-01T01:00:00Z"),
        forecast(generation=115, publish="2025-12-31T09:50:00Z"),
        forecast(generation=999, publish="2025-12-31T09:50:01Z"),
        forecast(generation=110, publish="2025-12-31T09:00:00Z"),
        forecast("2026-01-01T01:00:00Z", 130, "2025-12-31T08:00:00Z"),
    ]
    points, _ = compare(DAY, ASSUMED, [], forecasts)
    assert points[0].forecast_mw == 115
    assert points[1].forecast_mw == 130
    strict, _ = compare(DAY, DecisionPolicy(cutoff_inclusive=False), [], forecasts)
    assert strict[0].forecast_mw == 110


def test_hourly_matching_and_known_metrics():
    actuals = [
        actual(generation=80),
        actual("2026-01-01T00:30:00Z", 120),
        actual("2026-01-01T01:00:00Z", 200),
        actual("2026-01-01T01:30:00Z", 200),
    ]
    forecasts = [forecast(generation=110), forecast("2026-01-01T01:00:00Z", 180)]
    points, quality = compare(DAY, ASSUMED, actuals, forecasts)
    result = metrics(points, ASSUMED)
    assert len(points) == 24
    assert points[0].actual_mw == 100
    assert points[0].actual_half_hour_mw == [80, 120]
    assert quality.available_pairs == quality.evaluated_pairs == 2
    assert result.mae_mw == 15
    assert result.rmse_mw == pytest.approx(sqrt(250))
    assert result.signed_bias_mw == -5
    assert result.wape_percent == 10
    assert result.wape_denominator_absolute_actual_mw_sum == 300
    assert result.mape_positive_actual_percent == 10
    assert result.mape_positive_actual_count == 2


def test_no_silent_averaging_assumption():
    policy = DecisionPolicy()
    points, quality = compare(DAY, policy, [actual(), actual("2026-01-01T00:30:00Z")], [forecast()])
    result = metrics(points, policy)
    assert quality.available_pairs == 1
    assert quality.evaluated_pairs == 0
    assert points[0].actual_mw == 100
    assert points[0].forecast_mw == 120
    assert points[0].signed_error_mw is None
    assert result.mae_mw is None
    assert result.status == "semantics_unverified"


def test_missing_half_hour_not_filled_or_paired_with_neighbor():
    points, quality = compare(
        DAY, ASSUMED, [actual(), actual("2026-01-01T01:00:00Z", 500)], [forecast()]
    )
    assert points[0].actual_mw is None
    assert points[0].actual_half_hour_mw == [100, None]
    assert "missing_actual" in points[0].issues
    assert quality.available_pairs == 0
    assert metrics(points, ASSUMED).status == "no_valid_pairs"


def test_duplicates_do_not_change_metrics_or_count_and_nonwind_is_filtered():
    a = actual()
    f = forecast()
    points, quality = compare(
        DAY,
        ASSUMED,
        [a, a, actual("2026-01-01T00:30:00Z"), actual(fuel="CCGT", generation=999)],
        [f, f],
    )
    assert points[0].actual_mw == 100
    assert quality.actual_duplicate_rows == 1
    assert quality.forecast_duplicate_rows == 1
    assert quality.available_pairs == 1
    assert metrics(points, ASSUMED).mae_mw == 20


@pytest.mark.parametrize("reverse", [False, True])
def test_conflict_never_last_row_wins_or_falls_back(reverse):
    rows = [
        forecast(generation=90),
        forecast(generation=100),
        forecast(generation=80, publish="2025-12-31T08:00:00Z"),
    ]
    points, quality = compare(DAY, ASSUMED, [], reversed(rows) if reverse else rows)
    assert points[0].forecast_mw is None
    assert points[0].forecast_publish_time == instant("2025-12-31T09:30:00Z")
    assert "conflicting_forecast" in points[0].issues
    assert quality.forecast_conflicting_keys == 1


def test_actual_revision_conflicts_and_null_latest_forecast():
    a = [actual(), actual(generation=101), actual("2026-01-01T00:30:00Z")]
    f = [forecast(generation=None), forecast(publish="2025-12-31T08:00:00Z")]
    points, quality = compare(DAY, ASSUMED, a, f)
    assert {"conflicting_actual", "null_forecast"}.issubset(points[0].issues)
    assert quality.actual_conflicting_keys == 1
    revised = actual(generation=150, publish="2026-01-02T00:00:00Z")
    points, _ = compare(DAY, ASSUMED, [*a, revised], [])
    assert points[0].actual_mw == 125


@pytest.mark.parametrize("actual_mw,expected_wape", [(0, None), (-10, 1100)])
def test_zero_negative_denominators_and_sign(actual_mw, expected_wape):
    points, _ = compare(
        DAY,
        ASSUMED,
        [actual(generation=actual_mw), actual("2026-01-01T00:30:00Z", actual_mw)],
        [forecast(generation=100)],
    )
    result = metrics(points, ASSUMED)
    assert result.wape_percent == expected_wape
    assert result.mape_positive_actual_percent is None
    assert result.percentage_excluded_nonpositive_actual_count == 1
    assert result.signed_bias_mw == 100 - actual_mw


def test_empty_results_are_null_not_zero_success():
    points, quality = compare(DAY, ASSUMED, [], [])
    assert quality.available_pair_coverage_percent == 0
    assert len(points) == 24
    assert metrics(points, ASSUMED).mae_mw is None


@pytest.mark.parametrize(
    "change",
    [
        {"generation": True},
        {"generation": "123"},
        {"generation": float("nan")},
        {"startTime": "2026-01-01T00:00:00"},
        {"publishTime": None},
        {"startTime": "2026-01-01T00:30:00Z"},
        {"dataset": "DGWS"},
        {"generation": 2**63},
    ],
)
def test_forecast_schema_rejects_invalid_rows(change):
    with pytest.raises(ValidationError):
        ForecastRecord.model_validate(payload(forecast()) | change)


def test_timestamp_offsets_normalize_and_actual_metadata_validates():
    row = ForecastRecord.model_validate(
        payload(forecast()) | {"startTime": "2026-01-01T01:00:00+01:00"}
    )
    assert row.start_time == datetime(2026, 1, 1, tzinfo=UTC)
    with pytest.raises(ValidationError):
        ActualRecord.model_validate(payload(actual()) | {"settlementPeriod": 48})
