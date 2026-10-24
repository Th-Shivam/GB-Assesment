import asyncio

import httpx
import pytest
from pydantic import ValidationError

from app.main import create_app
from tests.factories import actual, forecast, instant, payload

BASE = "/api/v1/wind"
DAY_QUERY = {"start_date": "2026-01-01", "end_date": "2026-01-01"}
ASSUMED_QUERY = DAY_QUERY | {"comparison_mode": "hourly_average_assumption"}


def exercise(settings, handler, action):
    async def run():
        app = create_app(settings, transport=httpx.MockTransport(handler))
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as api:
                return await action(api)

    return asyncio.run(run())


def synthetic_handler(calls):
    actuals = [
        actual(),
        actual("2026-01-01T00:30:00Z", 200),
        actual("2026-01-31T23:00:00Z", 50),
        actual("2026-01-31T23:30:00Z", 100),
    ]
    forecasts = [
        forecast(generation=140),
        forecast(generation=160, publish="2025-12-31T09:50:00Z"),
        forecast(generation=999, publish="2025-12-31T10:30:00Z"),
        forecast(generation=999, publish="2026-01-01T12:00:00Z"),
        forecast("2026-01-31T23:00:00Z", 75, "2026-01-30T09:30:00Z"),
    ]

    def handler(request):
        calls.append(request)
        params = request.url.params
        if request.url.path.endswith("/FUELHH/stream"):
            rows = [
                r for r in actuals if r.settlement_date.isoformat() == params["settlementDateFrom"]
            ]
        else:
            lower, upper = (
                instant(params[k]) for k in ("publishDateTimeFrom", "publishDateTimeTo")
            )
            rows = [r for r in forecasts if lower <= r.publish_time <= upper]
        return httpx.Response(200, json=[payload(row) for row in rows])

    return handler


def test_health_no_upstream_request_and_openapi_typed(settings):
    calls = []

    async def action(api):
        health = await api.get("/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok", "scope": "process_liveness_only"}
        schema = (await api.get("/openapi.json")).json()
        for endpoint in ("summary", "series", "errors", "publications"):
            response = schema["paths"][f"{BASE}/{endpoint}"]["get"]["responses"]["200"]
            assert "$ref" in response["content"]["application/json"]["schema"]
        assert not calls

    exercise(settings, synthetic_handler(calls), action)


def test_cors_exact_allowlist_handles_preflight_without_credentials(settings):
    calls = []
    cors_settings = settings.__class__(
        cors_origins="https://winddesk.example.com/, https://preview.example.com"
    )

    async def action(api):
        preflight = await api.options(
            "/health",
            headers={
                "Origin": "https://winddesk.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == "https://winddesk.example.com"
        assert preflight.headers["access-control-allow-methods"] == "GET"
        assert "access-control-allow-credentials" not in preflight.headers

        allowed = await api.get("/health", headers={"Origin": "https://preview.example.com"})
        assert allowed.headers["access-control-allow-origin"] == "https://preview.example.com"
        denied = await api.get("/health", headers={"Origin": "https://evil.example.com"})
        assert "access-control-allow-origin" not in denied.headers
        assert not calls

    exercise(cors_settings, synthetic_handler(calls), action)


def test_cors_rejects_wildcard_and_non_origin_values(settings):
    for value in (
        "*",
        "https://*.example.com",
        "https://example.com/path",
        "https://user:pass@example.com",
    ):
        with pytest.raises(ValidationError):
            settings.__class__(cors_origins=value)


def test_summary_series_errors_cache_and_assumption_gating(settings):
    calls = []

    async def action(api):
        unverified = (await api.get(f"{BASE}/summary", params=DAY_QUERY)).json()
        assert unverified["metrics"]["status"] == "semantics_unverified"
        assert unverified["metrics"]["mae_mw"] is None
        count = len(calls)
        response = await api.get(f"{BASE}/series", params=ASSUMED_QUERY)
        assert response.status_code == 200
        result = response.json()
        assert len(result["data"]) == 24
        point = result["data"][0]
        assert point["actual_mw"] == 150
        assert point["forecast_mw"] == 160
        assert point["actual_half_hour_mw"] == [100, 200]
        assert point["decision_cutoff"] == "2025-12-31T09:50:00Z"
        assert point["signed_error_mw"] == 10
        assert result["metrics"]["mae_mw"] == 10
        assert result["metrics"]["wape_percent"] == pytest.approx(1000 / 150)
        assert result["quality"]["available_pairs"] == 1
        assert result["metadata"]["forecast_semantics_verified"] is False
        assert result["metadata"]["market_gate_time"] == "09:50"
        assert result["metadata"]["internal_decision_time"] is None
        assert all(f["cache_hit"] for f in result["metadata"]["fetches"])
        errors = (await api.get(f"{BASE}/errors", params=ASSUMED_QUERY)).json()
        assert errors["by_day"][0]["metrics"]["mae_mw"] == 10
        assert len(errors["largest_absolute_errors"]) == 1
        assert len(calls) == count
        strict = (
            await api.get(f"{BASE}/series", params=ASSUMED_QUERY | {"cutoff_inclusive": "false"})
        ).json()
        assert strict["data"][0]["forecast_mw"] == 140

    exercise(settings, synthetic_handler(calls), action)


def test_default_month_includes_final_hour_and_february_actual_publication(settings):
    async def action(api):
        result = (
            await api.get(f"{BASE}/series", params={"comparison_mode": "hourly_average_assumption"})
        ).json()
        assert len(result["data"]) == 744
        assert result["quality"]["expected_half_hours"] == 1488
        last = result["data"][-1]
        assert last["start_time"] == "2026-01-31T23:00:00Z"
        assert last["actual_publish_times"][-1] == "2026-02-01T00:00:00Z"
        assert last["actual_mw"] == 75
        assert last["signed_error_mw"] == 0

    exercise(settings, synthetic_handler([]), action)


def test_history_includes_ineligible_vintages_with_explicit_selection(settings):
    async def action(api):
        result = (
            await api.get(f"{BASE}/publications", params={"target": "2026-01-01T01:00:00+01:00"})
        ).json()
        assert result["target"] == "2026-01-01T00:00:00Z"
        assert result["status"] == "available"
        assert len(result["data"]) == 4
        assert sum(r["eligible"] for r in result["data"]) == 2
        selected = [r for r in result["data"] if r["selected"]]
        assert len(selected) == 1
        assert selected[0]["publish_time"] == "2025-12-31T09:50:00Z"
        assert not result["data"][-1]["eligible"]
        assert result["metadata"]["publication_search_end"] == "2026-01-02T00:00:00Z"

    exercise(settings, synthetic_handler([]), action)


@pytest.mark.parametrize(
    "query",
    [
        {"start_date": "nope"},
        {"start_date": "2025-12-31"},
        {"end_date": "2026-02-01"},
        {"start_date": "2026-01-03", "end_date": "2026-01-02"},
        {"market": "unknown"},
        {"market": "custom"},
        {"decision_time": "25:00"},
        {"market": "epex", "decision_time": "09:30"},
        {"comparison_mode": "fake"},
        {"cutoff_inclusive": "unknown"},
        {"unexpected": "parameter"},
    ],
)
def test_invalid_analysis_queries_do_not_contact_upstream(settings, query):
    calls = []

    async def action(api):
        response = await api.get(f"{BASE}/summary", params=query)
        assert response.status_code == 422, response.text
        assert not calls

    exercise(settings, synthetic_handler(calls), action)


@pytest.mark.parametrize(
    "target",
    [
        "2026-02-01T00:00:00Z",
        "2026-01-01T00:30:00Z",
        "2026-01-01T00:00:00",
        "bad",
    ],
)
def test_invalid_history_targets(settings, target):
    async def action(api):
        response = await api.get(f"{BASE}/publications", params={"target": target})
        assert response.status_code == 422

    exercise(settings, synthetic_handler([]), action)


def test_empty_data_returns_all_gaps_not_fake_scores(settings):
    async def action(api):
        response = await api.get(f"{BASE}/series", params=ASSUMED_QUERY)
        assert response.status_code == 200
        result = response.json()
        assert len(result["data"]) == 24
        assert result["quality"]["available_pairs"] == 0
        assert result["metrics"]["status"] == "no_valid_pairs"
        assert result["metrics"]["mae_mw"] is None
        history = (
            await api.get(f"{BASE}/publications", params={"target": "2026-01-01T00:00:00Z"})
        ).json()
        assert history["status"] == "empty"
        assert history["data"] == []

    exercise(settings, lambda req: httpx.Response(200, json=[]), action)


@pytest.mark.parametrize(
    "failure,expected,code",
    [
        ("timeout", 504, "upstream_timeout"),
        ("bad_schema", 502, "upstream_schema_error"),
        ("rate_limit", 503, "upstream_rate_limited"),
    ],
)
def test_failed_window_fails_analysis_not_partial_success(settings, failure, expected, code):
    def handler(request):
        if request.url.path.endswith("/FUELHH/stream"):
            return httpx.Response(200, json=[])
        if failure == "timeout":
            raise httpx.ReadTimeout("simulated", request=request)
        if failure == "rate_limit":
            return httpx.Response(429, headers={"Retry-After": "90"})
        return httpx.Response(200, json={"data": []})

    async def action(api):
        result = await api.get(f"{BASE}/summary", params=DAY_QUERY)
        assert result.status_code == expected
        assert result.json()["code"] == code
        assert "metrics" not in result.json()
        if failure == "rate_limit":
            assert result.headers["retry-after"] == "90"

    exercise(settings, handler, action)


def test_configured_internal_cutoff_and_market_override(settings):
    settings.internal_decision_time = "09:00"

    async def action(api):
        result = (await api.get(f"{BASE}/series", params=DAY_QUERY)).json()
        assert result["metadata"]["market_gate_time"] == "09:50"
        assert result["metadata"]["internal_decision_time"] == "09:00"
        assert result["data"][0]["forecast_mw"] is None
        custom = (
            await api.get(
                f"{BASE}/series", params=DAY_QUERY | {"market": "custom", "decision_time": "12:00"}
            )
        ).json()
        assert custom["metadata"]["market_gate_time"] is None
        assert custom["data"][0]["forecast_mw"] == 999

    exercise(settings, synthetic_handler([]), action)


def test_one_failed_window_does_not_cache_or_claim_latest(settings):
    failed = [True]
    handler = synthetic_handler([])

    def flaky(request):
        if request.url.params.get("publishDateTimeFrom") == "2025-12-31T00:00:00Z" and failed[0]:
            return httpx.Response(503)
        return handler(request)

    async def action(api):
        assert (await api.get(f"{BASE}/summary", params=DAY_QUERY)).status_code == 502
        failed[0] = False
        result = await api.get(f"{BASE}/summary", params=ASSUMED_QUERY)
        assert result.status_code == 200
        assert result.json()["metrics"]["mae_mw"] == 10

    exercise(settings, flaky, action)


@pytest.mark.parametrize("reverse", [False, True])
def test_history_duplicate_conflict_is_order_independent(settings, reverse):
    candidates = [forecast(generation=None), forecast(generation=130), forecast(generation=130)]

    def handler(request):
        if request.url.params.get("publishDateTimeFrom") == "2025-12-31T00:00:00Z":
            rows = list(reversed(candidates)) if reverse else candidates
            return httpx.Response(200, json=[payload(r) for r in rows])
        return httpx.Response(200, json=[])

    async def action(api):
        result = (
            await api.get(f"{BASE}/publications", params={"target": "2026-01-01T00:00:00Z"})
        ).json()
        row = result["data"][0]
        assert row["selected"] and row["eligible"] and row["conflicting"]
        assert row["generation_mw"] is None
        assert row["duplicate_rows"] == 1
        assert row["issues"] == ["conflicting_forecast"]

    exercise(settings, handler, action)


@pytest.mark.parametrize("generation,issue", [(None, "null_forecast"), (-1, "negative_forecast")])
def test_history_marks_invalid_selected_value(settings, generation, issue):
    def handler(request):
        rows = (
            [payload(forecast(generation=generation))]
            if (request.url.params.get("publishDateTimeFrom") == "2025-12-31T00:00:00Z")
            else []
        )
        return httpx.Response(200, json=rows)

    async def action(api):
        result = (
            await api.get(f"{BASE}/publications", params={"target": "2026-01-01T00:00:00Z"})
        ).json()
        assert result["data"][0]["issues"] == [issue]
        assert result["data"][0]["selected"]

    exercise(settings, handler, action)
