# FastAPI backend

Python **3.12+**; verified locally with Python 3.13. The frontend is not modified.
Read `../docs/data-methodology.md` for the scientific and market assumptions.

## Install and run

From `backend/`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For runtime-only installation use `requirements.txt`. On Windows use
`.venv\Scripts\python.exe` instead of `.venv/bin/python` (and omit `python3`).
`tzdata` provides IANA timezones where the OS does not. No API key is required.
Nothing fetches Elexon on import or startup; data loads on analytical requests.

- Interactive API documentation: `http://localhost:8000/docs`
- OpenAPI: `http://localhost:8000/openapi.json`
- Health: `http://localhost:8000/health` (process liveness, **not** upstream health)

Optional: copy `.env.example` to `.env` and edit the non-secret settings. The app
reads `.env` from its working directory; start it from `backend/`. Real `.env`
files, virtual environments, caches, and build artifacts are ignored by Git.

For a separate frontend origin, set `WIND_CORS_ORIGINS` to an exact comma-separated
HTTP(S) origin list, for example `https://winddesk.vercel.app`. Wildcards, paths,
credentials, query strings, and fragments are rejected; credentials are never enabled.
Leave it empty for same-origin access such as the local Nginx Compose proxy.

## Endpoints and common query parameters

| GET path | Response |
| --- | --- |
| `/health` | Process liveness only, no upstream request |
| `/api/v1/wind/summary` | Coverage, conditional/null metrics, policy and fetch provenance |
| `/api/v1/wind/series` | Summary plus every expected hourly slot, actual components, selected publication, and errors/gaps |
| `/api/v1/wind/errors` | Summary plus daily metrics and up to ten largest absolute errors |
| `/api/v1/wind/publications` | Bounded history for one hourly target, with eligibility, selection, conflicts, and duplicates |

Summary/series/errors accept:

| Query | Default / validation |
| --- | --- |
| `start_date`, `end_date` | `2026-01-01`, `2026-01-31`; inclusive GB dates, ordered, January only |
| `market` | Configured default `n2ex`; also `epex` or `custom` |
| `decision_time` | Optional `HH:MM` UK time on D-1; overrides configured internal time; cannot exceed a named market gate |
| `cutoff_inclusive` | Configured default `true`; `publishTime <= cutoff`; `false` uses strict `<` |
| `comparison_mode` | Configured default `unverified`; opt-in `hourly_average_assumption` enables conditional scores |

Publication history instead requires an offset-aware `target`, within January,
on a whole UTC hour; it accepts the same policy options, not the date-range
options. Unknown parameters and malformed dates/times return 422. A `custom`
scenario needs an explicitly supplied/configured decision time; its gate is null.

### Examples

```sh
# Complete January coverage, with accuracy scores withheld by default:
curl --fail-with-body 'http://localhost:8000/api/v1/wind/summary'

# EXPLICIT assumption: treat the hourly WINDFOR MW value as the mean over [t,t+1h).
# Results are conditional, not proof of verified WINDFOR averaging semantics.
curl --fail-with-body 'http://localhost:8000/api/v1/wind/series?start_date=2026-01-01&end_date=2026-01-01&comparison_mode=hourly_average_assumption'

# Separate EPEX morning scenario, and strict publication boundary sensitivity:
curl --fail-with-body 'http://localhost:8000/api/v1/wind/errors?market=epex&cutoff_inclusive=false&comparison_mode=hourly_average_assumption'

# Internal procurement decision before the N2EX market closes:
curl --fail-with-body 'http://localhost:8000/api/v1/wind/summary?market=n2ex&decision_time=09:00'

# Includes later publications but marks them ineligible for the decision:
curl --fail-with-body 'http://localhost:8000/api/v1/wind/publications?target=2026-01-01T00:00:00Z'
```

First-load latency includes daily Elexon requests. For a quick smoke check, use
one day before loading the month. These commands use **live** data, not fixtures;
an upstream failure is returned as an error, never replaced by synthetic data.

## How to interpret responses

- All output timestamps are UTC, and the decision timezone is `Europe/London`.
  Date-range end is inclusive, but returned `delivery_end_exclusive` is February 1
  midnight for the month. The last actual half-hour at January 31 23:30 is retained
  even though its publication is in February.
- Native actuals are half-hour MW averages. Each hourly actual requires both
  half-hours: `(a_00 + a_30) / 2`, never their sum. Constituents and their publication
  times are returned. Forecast timestamps/publications are preserved. No fill or
  interpolation is used for a missing half-hour or hourly forecast.
- `available_pairs` counts hours with both quantities available; `evaluated_pairs`
  is zero in unverified mode. That distinction prevents data coverage being
  presented as completed scientific validation. Expected month sizes: 1,488
  actual half-hours and 744 potential hourly pairs.
- Metrics status is `semantics_unverified`, `no_valid_pairs`, or
  `available_under_assumption`. Undefined scores are JSON null, never NaN/Infinity
  or a fake zero. The verified-semantics flag stays false even after opting in.
- Errors and bias use **forecast minus actual**: positive means over-forecast wind.
  MAE/RMSE/bias use the same evaluated pair set and MW units. WAPE divides summed
  absolute errors by summed absolute actual MW for equal-duration hours; this
  denominator is returned. MAPE is a separately labeled positive-actual subset;
  its count and nonpositive exclusions are returned. Zero/near-zero pitfalls are
  documented, with no epsilon trick or `100 - error` accuracy score.
- `excluded_by_reason` counts affected hours; reasons can overlap and must not be
  summed as if mutually exclusive. Negative values remain flagged, not clamped;
  they remain in MW metrics, while individual relative percentages are suppressed
  for nonpositive actuals. A null or conflicted latest version never causes an
  unnoticed fallback to an older forecast/actual.
- History's `selected` marks the latest eligible **record key**, even if that key
  is null/conflicted and unusable for metrics. Conflicting values are not arbitrarily
  displayed as one winner. Post-cutoff records remain visible but ineligible.
- Actuals are the latest version returned in the current extraction, not guaranteed
  final settlement quantities. `publishTime` is not trader receipt. Full source
  retention, unadvertised HTTP trailers, and January emergency market extensions
  cannot be proven by this backend.

## Failure policy and cache

Upstream data is validated with strict numeric fields, aware timestamps, dataset
identity, settlement consistency, and native cadence. Malformed rows fail a
window rather than silently losing the latest publication. Null generation is
accepted as missing. Valid non-WIND FUELHH rows are filtered defensively.

- **422:** invalid client query (FastAPI validation `detail`).
- **502:** upstream rejection, transport/HTTP 5xx failure, schema/filter mismatch,
  oversized payload, or advertised trailers that HTTPX cannot verify.
- **503:** upstream 429; `Retry-After` is honored/forwarded where provided.
- **504:** upstream timeout after bounded retries.
- **200 + gaps/null metrics:** successful requests with no/partial observations;
  never confused with failed retrieval. If any required window fails, the whole
  analytical request fails rather than claiming the remaining data is latest.

Upstream failures have typed `code`, `message`, and `retry_after_seconds` fields.
Raw upstream error bodies are not exposed. 400/401/403 are not retried. Transient
errors use at most three retries with backoff/jitter; a `Retry-After` exceeding
the configured wait budget causes a failure rather than an early retry.

Daily batches use an in-memory TTL/LRU cache: default **3,600 seconds / 128 entries**,
four concurrent upstream calls, 30-second HTTP timeout, and an 8 MiB response
size guard. Same-key loads are coalesced; failed loads are not cached. Summary,
series, errors, and history reuse those batches; policy changes recompute selection
instead of reusing a score for a different cutoff. Cache hits preserve original
retrieval times and checksums. This is **not durable storage** and is per worker.
No production correctness depends on a local filesystem or a warm cache. Before
large public deployment, consider a shared cache and an inbound request budget;
neither a managed storage service nor a production availability SLA is claimed here.

Publication search starts three days before the requested delivery-range start
by default, then covers each day through the final delivery day's D-1. History
includes publications through the end of its target's delivery day. Bounds are
returned; a missing forecast means no candidate in that searched history, not
proof no earlier forecast existed. `WIND_LOOKBACK_DAYS` (1-14) can extend it.

All configurable defaults are in `.env.example` and `app/core/config.py`.
There is no database, background scheduler, authentication system, or fixture mode.

## Checks (no network required)

From `backend/`:

```sh
.venv/bin/python -m pytest --cov=app --cov-report=term-missing
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
.venv/bin/mypy app
.venv/bin/python -m pip check
```

The test suite uses deliberately synthetic fixtures and `httpx.MockTransport`.
Real outbound HTTP transport is blocked in tests. It covers cutoff equality and
future exclusion, UK calendar timezone behavior, final January half-hour, missing
data, duplicates/conflicts/revisions, metric arithmetic and zero denominators,
typed endpoints, upstream failures, cache expiry/eviction, and shared loads.

For a live check, start Uvicorn and run the HTTP examples above; live availability
is not a deterministic unit-test assertion. Elexon requests never require a key.

## Layout and scope

```text
app/main.py             app lifecycle and sanitized upstream error handling
app/api/routes.py       typed query contracts and HTTP endpoints
app/core/              configuration, decision policy, date boundaries, errors
app/schemas/           validated source records and typed response contracts
app/services/elexon.py bounded upstream requests and per-process cache
app/services/analysis.py pure version selection, comparison, and metrics
app/services/wind.py   shared data loading and endpoint projections
tests/                 synthetic fixtures and mocked HTTP regression tests
```

No pandas/database/cache service is needed for this bounded month of data. Runtime
dependencies are pinned in `requirements.txt`; test/lint/type tools are separate
in `requirements-dev.txt`. Transitive packages are resolved by pip (no cross-platform
lockfile is claimed). Docker/deployment and the React dashboard are outside this
checkpoint. AI assistance is disclosed in the root README.
