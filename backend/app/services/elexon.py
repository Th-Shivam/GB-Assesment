import asyncio
import hashlib
import math
import random
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Literal

import httpx
from pydantic import TypeAdapter, ValidationError

from app.core.config import Settings
from app.core.errors import UpstreamError
from app.schemas.analytics import FetchProvenance
from app.schemas.source import ActualRecord, ForecastRecord

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
Dataset = Literal["FUELHH", "WINDFOR"]
Key = tuple[Dataset, date]
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
ACTUALS = TypeAdapter(list[ActualRecord])
FORECASTS = TypeAdapter(list[ForecastRecord])


@dataclass(frozen=True)
class Batch:
    actuals: tuple[ActualRecord, ...]
    forecasts: tuple[ForecastRecord, ...]
    provenance: FetchProvenance


def retry_after_seconds(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        seconds = float(value)
        return max(0.0, seconds) if math.isfinite(seconds) else None
    except ValueError:
        try:
            deadline = parsedate_to_datetime(value)
            if deadline.tzinfo is None:
                return None
            return max(0.0, (deadline - datetime.now(UTC)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return None


class ElexonClient:
    """Bounded per-process daily cache, shared HTTP client, and single-flight loads."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        settings: Settings,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.http = http
        self.settings = settings
        self.sleep = sleep
        self.clock = clock
        self.cache: OrderedDict[Key, tuple[float, Batch]] = OrderedDict()
        self.inflight: dict[Key, asyncio.Task[Batch]] = {}
        self.semaphore = asyncio.Semaphore(settings.upstream_concurrency)

    async def day(self, dataset: Dataset, day: date) -> Batch:
        key = (dataset, day)
        cached = self.cache.get(key)
        if cached and cached[0] > self.clock():
            self.cache.move_to_end(key)
            return replace(
                cached[1], provenance=cached[1].provenance.model_copy(update={"cache_hit": True})
            )
        self.cache.pop(key, None)
        if key not in self.inflight:
            self.inflight[key] = asyncio.create_task(self._load(key))
            # Retrieve background exceptions even if the only waiter disconnects.
            self.inflight[key].add_done_callback(
                lambda task: task.exception() if not task.cancelled() else None
            )
        # A cancelled caller must not cancel a load shared with another request.
        return await asyncio.shield(self.inflight[key])

    async def close(self) -> None:
        tasks = list(self.inflight.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # A task cancelled before its coroutine starts never executes _load's finally.
        self.inflight.clear()
        self.cache.clear()

    async def _load(self, key: Key) -> Batch:
        try:
            async with self.semaphore:
                batch = await self._fetch(*key)
            self.cache[key] = (self.clock() + self.settings.cache_ttl_seconds, batch)
            self.cache.move_to_end(key)
            while len(self.cache) > self.settings.cache_max_entries:
                self.cache.popitem(last=False)
            return batch
        finally:
            self.inflight.pop(key, None)

    async def _fetch(self, dataset: Dataset, day: date) -> Batch:
        if dataset == "FUELHH":
            params = {
                "settlementDateFrom": day.isoformat(),
                "settlementDateTo": day.isoformat(),
                "fuelType": "WIND",
            }
        else:
            params = {
                "publishDateTimeFrom": f"{day.isoformat()}T00:00:00Z",
                "publishDateTimeTo": f"{(day + timedelta(days=1)).isoformat()}T00:00:00Z",
            }
        url = httpx.URL(f"{BASE_URL}/datasets/{dataset}/stream", params=params)
        payload = await self._request(url)
        try:
            if dataset == "FUELHH":
                all_actuals = ACTUALS.validate_json(payload)
                # Validate before filtering so a malformed identity cannot conceal a revision.
                actuals = tuple(row for row in all_actuals if row.fuel_type == "WIND")
                forecasts: tuple[ForecastRecord, ...] = ()
                received = len(all_actuals)
                if any(row.settlement_date != day for row in actuals):
                    raise ValueError("Actual settlement filter was not respected.")
            else:
                actuals = ()
                forecasts = tuple(FORECASTS.validate_json(payload))
                received = len(forecasts)
                lower = datetime.combine(day, datetime.min.time(), UTC)
                upper = lower + timedelta(days=1)
                if any(not lower <= row.publish_time <= upper for row in forecasts):
                    raise ValueError("Forecast publication filter was not respected.")
        except (ValidationError, ValueError) as exc:
            raise UpstreamError(
                "upstream_schema_error",
                f"{dataset} returned invalid or unexpected records; no analysis was produced.",
            ) from exc
        return Batch(
            actuals=actuals,
            forecasts=forecasts,
            provenance=FetchProvenance(
                dataset=dataset,
                native_resolution_minutes=30 if dataset == "FUELHH" else 60,
                request_url=str(url),
                retrieved_at=datetime.now(UTC),
                sha256=hashlib.sha256(payload).hexdigest(),
                received_rows=received,
                accepted_rows=len(actuals) + len(forecasts),
            ),
        )

    async def _request(self, url: httpx.URL) -> bytes:
        for attempt in range(self.settings.upstream_retries + 1):
            retry_after = None
            try:
                async with self.http.stream(
                    "GET", url, timeout=self.settings.upstream_timeout_seconds
                ) as response:
                    if response.status_code == 200:
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > MAX_RESPONSE_BYTES:
                                raise UpstreamError(
                                    "upstream_size_error", "Daily response too large."
                                )
                        # HTTPX does not expose a portable trailer-validation interface.
                        # Advertised trailers cannot be silently treated as validated success.
                        if response.headers.get("trailer"):
                            raise UpstreamError(
                                "upstream_trailer_unverified",
                                "Cannot verify upstream error trailers.",
                            )
                        return bytes(content)
                    retry_after = retry_after_seconds(response.headers.get("retry-after"))
                    if response.status_code == 429:
                        error = UpstreamError(
                            "upstream_rate_limited",
                            "Elexon rate limit reached.",
                            503,
                            math.ceil(retry_after) if retry_after is not None else None,
                        )
                    elif response.status_code >= 500:
                        error = UpstreamError("upstream_unavailable", "Elexon is unavailable.", 502)
                    else:
                        raise UpstreamError(
                            "upstream_rejected_request",
                            f"Elexon rejected the request (HTTP {response.status_code}).",
                        )
            except httpx.TimeoutException:
                error = UpstreamError("upstream_timeout", "Elexon request timed out.", 504)
            except httpx.TransportError:
                error = UpstreamError("upstream_transport_error", "Elexon connection failed.", 502)
            if attempt == self.settings.upstream_retries:
                raise error
            if retry_after is not None:
                # Fail rather than truncate a long Retry-After and retry too early.
                if retry_after > self.settings.max_retry_wait_seconds:
                    error.retry_after = math.ceil(retry_after)
                    raise error
                delay = retry_after
            else:
                delay = min(2**attempt + random.random(), self.settings.max_retry_wait_seconds)
            await self.sleep(delay)
        raise AssertionError("Retry loop must return or raise")
