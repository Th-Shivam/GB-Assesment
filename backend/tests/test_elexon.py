import asyncio
from datetime import UTC, date, datetime, timedelta
from email.utils import format_datetime

import httpx
import pytest

from app.core.errors import UpstreamError
from app.services.elexon import ElexonClient, retry_after_seconds
from tests.factories import actual, forecast, payload

DAY = date(2026, 1, 1)
PUB_DAY = date(2025, 12, 31)


def execute(settings, handler, action, *, sleep=None, clock=None):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            options = {}
            if sleep is not None:
                options["sleep"] = sleep
            if clock is not None:
                options["clock"] = clock
            client = ElexonClient(http, settings, **options)
            try:
                return await action(client)
            finally:
                await client.close()

    return asyncio.run(run())


def test_query_contract_cache_reuse_and_defensive_wind_filter(settings):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.params["fuelType"] == "WIND"
        assert request.url.params["settlementDateFrom"] == "2026-01-01"
        assert request.url.params["settlementDateTo"] == "2026-01-01"
        assert "Authorization" not in request.headers
        return httpx.Response(200, json=[payload(actual()), payload(actual(fuel="CCGT"))])

    async def action(client):
        first = await client.day("FUELHH", DAY)
        second = await client.day("FUELHH", DAY)
        assert len(first.actuals) == 1
        assert first.provenance.received_rows == 2
        assert first.provenance.accepted_rows == 1
        assert not first.provenance.cache_hit
        assert second.provenance.cache_hit
        assert first.provenance.sha256 == second.provenance.sha256
        assert len(calls) == 1

    execute(settings, handler, action)


def test_forecast_publication_params_keep_both_timestamps(settings):
    def handler(request):
        assert dict(request.url.params) == {
            "publishDateTimeFrom": "2025-12-31T00:00:00Z",
            "publishDateTimeTo": "2026-01-01T00:00:00Z",
        }
        return httpx.Response(200, json=[payload(forecast())])

    async def action(client):
        batch = await client.day("WINDFOR", PUB_DAY)
        assert batch.forecasts[0].start_time.date() == DAY
        assert batch.forecasts[0].publish_time.date() == PUB_DAY

    execute(settings, handler, action)


def test_cache_ttl_eviction_and_single_flight(settings):
    settings.cache_max_entries = 1
    settings.cache_ttl_seconds = 10
    now = [0.0]
    calls = []

    async def handler(request):
        calls.append(request)
        await asyncio.sleep(0)
        return httpx.Response(200, json=[])

    async def action(client):
        await asyncio.gather(*(client.day("FUELHH", DAY) for _ in range(5)))
        assert len(calls) == 1
        now[0] = 11
        await client.day("FUELHH", DAY)
        assert len(calls) == 2
        await client.day("WINDFOR", PUB_DAY)
        assert len(client.cache) == 1
        await client.day("FUELHH", DAY)
        assert len(calls) == 4

    execute(settings, handler, action, clock=lambda: now[0])


def test_cancelled_waiter_does_not_cancel_shared_load(settings):
    async def action(client):
        first = asyncio.create_task(client.day("FUELHH", DAY))
        await asyncio.sleep(0)
        second = asyncio.create_task(client.day("FUELHH", DAY))
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        result = await second
        assert result.actuals == ()

    async def handler(request):
        await asyncio.sleep(0.01)
        return httpx.Response(200, json=[])

    execute(settings, handler, action)


@pytest.mark.parametrize(
    "status,expected,code,attempts",
    [
        (400, 502, "upstream_rejected_request", 1),
        (403, 502, "upstream_rejected_request", 1),
        (429, 503, "upstream_rate_limited", 4),
        (503, 502, "upstream_unavailable", 4),
    ],
)
def test_status_errors_retry_budget_and_no_error_caching(
    settings, status, expected, code, attempts
):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, text="provider message must not leak")

    async def action(client):
        with pytest.raises(UpstreamError) as error:
            await client.day("FUELHH", DAY)
        assert error.value.status == expected
        assert error.value.code == code
        assert "provider message" not in str(error.value)
        assert len(calls) == attempts
        assert not client.cache
        assert not client.inflight

    execute(settings, handler, action)


@pytest.mark.parametrize(
    "failure,code,status",
    [
        (httpx.ReadTimeout, "upstream_timeout", 504),
        (httpx.ConnectError, "upstream_transport_error", 502),
    ],
)
def test_transport_failures(settings, failure, code, status):
    calls = []

    def handler(request):
        calls.append(request)
        raise failure("simulated", request=request)

    async def action(client):
        with pytest.raises(UpstreamError) as error:
            await client.day("FUELHH", DAY)
        assert error.value.code == code
        assert error.value.status == status
        assert len(calls) == 4

    execute(settings, handler, action)


def test_retry_after_honored_before_success(settings):
    settings.max_retry_wait_seconds = 5
    calls, waits = [], []

    async def sleep(seconds):
        waits.append(seconds)

    def handler(request):
        calls.append(request)
        return (
            httpx.Response(429, headers={"Retry-After": "2"})
            if len(calls) == 1
            else httpx.Response(200, json=[])
        )

    async def action(client):
        result = await client.day("FUELHH", DAY)
        assert result.actuals == ()
        assert waits == [2]
        assert len(calls) == 2

    execute(settings, handler, action, sleep=sleep)


def test_long_retry_after_fails_instead_of_retrying_early(settings):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "120"})

    async def action(client):
        with pytest.raises(UpstreamError) as error:
            await client.day("FUELHH", DAY)
        assert error.value.retry_after == 120
        assert len(calls) == 1

    execute(settings, handler, action)


@pytest.mark.parametrize("text", ['{"data": []}', '[{"dataset":', "[null]", "[{}]"])
def test_malformed_stream_is_not_success_or_cached(settings, text):
    async def action(client):
        with pytest.raises(UpstreamError, match="invalid or unexpected"):
            await client.day("WINDFOR", PUB_DAY)
        assert not client.cache

    execute(settings, lambda req: httpx.Response(200, text=text), action)


def test_publication_filter_violation_fails_closed(settings):
    async def action(client):
        with pytest.raises(UpstreamError) as error:
            await client.day("WINDFOR", date(2025, 12, 30))
        assert error.value.code == "upstream_schema_error"

    execute(settings, lambda req: httpx.Response(200, json=[payload(forecast())]), action)


def test_response_size_bound_and_advertised_trailers(settings, monkeypatch):
    async def action(client):
        with pytest.raises(UpstreamError) as error:
            await client.day("FUELHH", DAY)
        return error.value.code

    code = execute(
        settings, lambda req: httpx.Response(200, json=[], headers={"Trailer": "error"}), action
    )
    assert code == "upstream_trailer_unverified"
    monkeypatch.setattr("app.services.elexon.MAX_RESPONSE_BYTES", 1)
    code = execute(settings, lambda req: httpx.Response(200, json=[]), action)
    assert code == "upstream_size_error"


@pytest.mark.parametrize("raw", [None, "bad", "nan", "inf", "-inf"])
def test_invalid_retry_after(raw):
    assert retry_after_seconds(raw) is None


def test_retry_after_http_date_and_past():
    future = format_datetime(datetime.now(UTC) + timedelta(seconds=60))
    delay = retry_after_seconds(future)
    assert delay is not None and 58 <= delay <= 60
    assert retry_after_seconds("-1") == 0


def test_actual_settlement_filter_violation(settings):
    async def action(client):
        with pytest.raises(UpstreamError) as error:
            await client.day("FUELHH", date(2026, 1, 2))
        assert error.value.code == "upstream_schema_error"
        assert not client.cache

    execute(settings, lambda req: httpx.Response(200, json=[payload(actual())]), action)


def test_concurrent_loads_obey_upstream_limit_and_shutdown_cancels(settings):
    settings.upstream_concurrency = 2
    active, maximum = [0], [0]

    async def handler(request):
        active[0] += 1
        maximum[0] = max(maximum[0], active[0])
        try:
            await asyncio.sleep(0.005)
            return httpx.Response(200, json=[])
        finally:
            active[0] -= 1

    async def action(client):
        await asyncio.gather(*(client.day("FUELHH", date(2026, 1, d)) for d in range(1, 8)))
        assert maximum[0] == 2
        pending = asyncio.create_task(client.day("FUELHH", date(2026, 1, 8)))
        await asyncio.sleep(0)
        await client.close()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert not client.cache
        assert not client.inflight

    execute(settings, handler, action)
