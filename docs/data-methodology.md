# Wind-generation data methodology and technical specification

Research date: **24 October 2026**. Scope: delivery during **January 2026**.
Status: **backend methodology version 2.0**, implemented in `backend/`.
The historical probes in section 4 belong to the original research checkpoint.
Section 13 records the implementation decisions and remaining uncertainty.
References are listed in section 12. No unconditional accuracy claim is made.

## 1. Findings and scope

- **Historical data is available in the required datasets.** Live unauthenticated
  requests returned all 1,488 January half-hour FUELHH wind observations and
  multiple historical WINDFOR publications. Section 4 records the exact probes.
- **The resolutions differ:** FUELHH contains half-hour average MW outturn;
  WINDFOR contains hourly forecast target timestamps in the inspected history.
  Joining identical timestamps alone would leave every `:30` actual unmatched.
  Do not manufacture a native half-hour forecast series.
- **There is no single UK day-ahead deadline.** EPEX and Nord Pool have distinct
  auctions. Section 5 documents named decision scenarios, not an invented cutoff.
- A forecast published after the chosen decision deadline must never enter its
  backtest, even if that forecast is the latest available when the app runs.
- "National wind" here means the **Great Britain aggregate represented by these
  BMRS datasets**, not a UK-wide total including Northern Ireland, and not an
  estimate of every embedded wind generator. No capacity uplift is applied.

### Source coverage

FUELHH aggregates generation by fuel category for Great Britain. Retain only
`dataset == "FUELHH"` and `fuelType == "WIND"`, both in the request and after
validation; do not sum all fuel categories or treat each returned row as a wind
farm. Its generation is a 30-minute average in **MW**, not MWh. [R1, R3]

WINDFOR is already the aggregate wind forecast: there is no `fuelType`, region,
BM-unit, onshore/offshore, or `processType` filter in its stream contract. Validate
`dataset == "WINDFOR"`; no extra national-selection filter is required. Elexon's
wind page describes the forecast as one MW value across the covered Power Park
Modules, for wind farms visible to the system operator with operational metering.
It explicitly compares this forecast with Generation by Fuel Type outturn. [R2, R5]

Elexon also warns that Generation by Fuel Type excludes embedded generation and
wind farms without operational meters. Thus "actual" is operational outturn for
this coverage, **not final settlement-metered production or unconstrained wind
potential**. Curtailment and changing coverage can affect the comparison; these
two datasets alone do not isolate weather-model error. [R5, R6]

## 2. Verified HTTP contract

Production base URL, obtained from Elexon's published OpenAPI document [R3]:

```text
https://data.elexon.co.uk/bmrs/api/v1
```

The supplied `bmrs.elexon.co.uk/api-documentation/...` URLs are documentation
pages, not the data request URLs. The pages load the OpenAPI definition at:

```text
https://data.elexon.co.uk/swagger/v1/swagger.json
```

### 2.1 FUELHH stream

`GET /datasets/FUELHH/stream` supports these query parameters [R1, R3]:

| Parameter | OpenAPI type | Use |
| --- | --- | --- |
| `publishDateTimeFrom` | string, date-time | Lower publication-time bound |
| `publishDateTimeTo` | string, date-time | Upper publication-time bound |
| `settlementDateFrom` | string, date | Lower settlement-date bound, exactly `yyyy-MM-dd` |
| `settlementDateTo` | string, date | Upper settlement-date bound, exactly `yyyy-MM-dd` |
| `settlementPeriod` | array of int32, unique items | Optional settlement-period selection |
| `fuelType` | array of strings | Use the single value `WIND` |

None is marked required in OpenAPI, but our client must supply explicit bounded
dates. **Do not mix either settlement-date parameter with either publication-date
parameter.** A mixed request was tested and returned HTTP 400. For arrays, use
repeated query keys if multiple values are needed; this assessment needs only
`fuelType=WIND`. No `startTime`, `from`, `to`, page number, cursor, limit, or format
parameter is declared for this stream.

Use settlement dates for this month's actuals:

```text
https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream?settlementDateFrom=2026-01-01&settlementDateTo=2026-01-31&fuelType=WIND
```

The probe demonstrated inclusive settlement dates. A separate exact-publication
probe included the final January observation published at February 1 midnight.
Always enforce the desired half-open delivery range locally; publication dates
are not interchangeable with delivery dates.

### 2.2 WINDFOR stream

`GET /datasets/WINDFOR/stream` declares only [R2, R3]:

| Parameter | OpenAPI type | Use |
| --- | --- | --- |
| `publishDateTimeFrom` | string, date-time | Lower publication-time bound |
| `publishDateTimeTo` | string, date-time | Upper publication-time bound |

Without publication filters, this endpoint returns the latest published forecast,
**not January history**. It has no delivery-date filter: fetch publication windows,
then filter `startTime` locally. Do not pass FUELHH's settlement or fuel parameters
to WINDFOR and assume they worked; reject unsupported parameters in our client.

This research used a window including the previous year's publications:

```text
https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream?publishDateTimeFrom=2025-12-30T00:00:00Z&publishDateTimeTo=2026-02-01T00:00:00Z
```

An exact `From == To == 2025-12-31T07:30:00Z` query returned that publication's
73 records, demonstrating inclusion of both bounds in this case. OpenAPI does
not explicitly specify boundary operators; use overlapping adjacent publication
windows, deduplicate, and apply our own time predicates after retrieval. Do not
subtract an arbitrary millisecond from API bounds.

### 2.3 Pagination, access, limits, and failures

- Both streams return a **top-level JSON array**, not a `{data: [...]}` envelope,
  NDJSON feed, or live subscription. There are no documented pagination controls
  or continuation tokens. Consume the entire response and validate completion.
- Elexon's guidance states that stream endpoints have no data-return limits and
  return JSON only. That is not a guarantee against transport timeouts, oversized
  responses, or retention gaps. Use small publication/settlement windows (initially
  one day) for retryability; daily chunking is **our strategy**, not API pagination.
- OpenAPI specifies no security scheme or authentication requirement for these
  GET operations. Live requests succeeded without API keys, accounts, cookies,
  or Authorization headers. No secret is needed for this integration.
- Elexon's guidance publishes **5,000 requests per minute per user**, with possible
  endpoint-specific limits. Neither of these operations declares an additional
  limit. Do not infer how an anonymous "user" is identified, or load-test the cap.
  The probes exposed no rate-limit or retry headers. Cache and use low concurrency.
- Documented responses are 200, 400, 429, and 500. Transport failures and other
  HTTP statuses must still be handled. Elexon notes that streaming failures may
  be described in response **trailers**. HTTP 200 alone is not proof of success:
  require a complete, parseable array and perform coverage checks. Inspect trailers
  where supported; do not claim trailer validation if the selected client lacks it.
  [R3, R4]

## 3. Fields, types, and time meanings

The authoritative schemas are
`Insights.Api.Models.Responses.Generation.DatasetRows.AugmentedOutturnData` and
`Insights.Api.Models.Responses.Generation.DatasetRows.WindGenerationForecast`.
Both have `additionalProperties: false`; neither supplies a `required` list. Our
normalizer must therefore explicitly validate required fields rather than treating
the illustrative schema as proof every row is usable. [R3]

| Field | FUELHH schema | WINDFOR schema | Meaning and handling |
| --- | --- | --- | --- |
| `dataset` | nullable string | nullable string | Dataset identity, expected `FUELHH` or `WINDFOR` |
| `startTime` | nullable date-time string | date-time string | Target/delivery timestamp, not the issue timestamp; FUELHH half-hour interval start; WINDFOR hourly target in the inspected data |
| `publishTime` | nullable date-time string | date-time string | Publication timestamp attached to the record; distinguishes forecast vintages for one target |
| `generation` | nullable int64 | nullable int64 | MW: average half-hour outturn for FUELHH; forecast MW for WINDFOR |
| `fuelType` | nullable string | absent | Actual-generation category; retain exactly `WIND` |
| `settlementDate` | nullable date string | absent | Local GB settlement day; cross-check against `startTime` |
| `settlementPeriod` | nullable int32 | absent | Settlement-period number within that local day |

All probed timestamp strings carried `Z` (UTC). Parse offset-aware timestamps,
normalize to UTC, and reject ambiguous naive timestamps; do not silently attach
the machine's timezone. Preserve source timestamp precision and original values.

`publishTime` is the source's recorded publication time, **not** forecast delivery,
our download time, an auction result time, or verified receipt by a trader. The
stream exposes no separate first-publicly-accessible/received timestamp or
revision sequence. A retrospective availability claim is therefore conditional
on the source publication-time semantics; section 7 makes that limitation explicit.

The reviewed sources establish hourly WINDFOR targets and MW units but do not
unambiguously define whether each value is an average over the following hour
or a point forecast at its timestamp. **Do not silently resolve this by treating
it as a half-hour average.** See the proposed comparison and approval gate in
sections 6 and 11. [R1, R3, R5]

## 4. Historical availability: live research evidence

These are **retrieval/coverage observations**, not forecast-performance results.
Requests used Python's standard-library HTTP/JSON facilities, without installing
dependencies, changing application code, or storing datasets in Git.

| Probe | UTC retrieval time on 2026-10-24 | Result |
| --- | --- | --- |
| January FUELHH URL in section 2.1 | 16:45:36 | HTTP 200; 1,488 rows, 1,488 unique delivery starts; every expected half-hour present |
| WINDFOR publication window in section 2.2 | 16:45:47 | HTTP 200; 19,272 rows; 264 distinct publication timestamps; 841 distinct hourly targets across the wider window |
| WINDFOR exact publication `2025-12-31T07:30:00Z` | Research session | HTTP 200; 73 rows, all with that publication time |
| WINDFOR exact publication `2025-12-31T08:30:00Z` | 16:45:48 | HTTP 200; empty array, demonstrating why a nominal timetable cannot determine availability |
| FUELHH publication bounds both `2026-02-01T00:00:00Z`, `fuelType=WIND` | 16:45:49 | HTTP 200; one row, delivery `2026-01-31T23:30:00Z`, settlement period 48 |
| FUELHH mixed settlement-date/publication-date request | Research session | HTTP 400 with a validation error forbidding that parameter combination |

For the first two responses, there were no null or negative `generation` values,
and no repeated or conflicting `(startTime, publishTime)` keys. This observation
is not a guarantee for future requests. Actual publication timestamps numbered
1,486 despite 1,488 delivery starts: publication time is **not** an actual-row key.

Response-byte SHA-256 identifiers for reproducibility (responses may later change):

```text
FUELHH January:
085c112a01898fc3a80ee24d59a6531d7a80693a6ffa8174993314c935ca93c5
WINDFOR publication window:
3e59c8cd6558a8a7e13583bfee09d14872c7f140d112abb34e27b2b53bf3940b
```

The FUELHH delivery range was `2026-01-01T00:00:00Z` through
`2026-01-31T23:30:00Z`. Its publication range extended through
`2026-02-01T00:00:00Z`. The wider WINDFOR response contained target timestamps
from `2025-12-29T21:00:00Z` through `2026-02-02T21:00:00Z`; all target minutes were
`:00`. After selecting January targets and publications strictly before the
previous day's 09:20 or 09:50 UTC, each scenario had **744 eligible hourly targets**,
not 1,488 native half-hour forecasts. The probe checked timestamps/eligibility,
not forecast accuracy or trader receipt.

### Documentation versus observed schedule

Elexon's prose lists eight update times: 03:30, 05:30, 08:30, 10:30, 12:30, 16:30,
19:30, and 23:30. Its wind page describes a forecast horizon from 20:00 on D to
20:00 on D+2. [R3, R5]

The inspected UTC publication times were instead 02:30, 04:30, 07:30, 09:30, 11:30,
15:30, 18:30, and 22:30, plus a 12:25 timestamp. One inspected publication
contained 73 hourly target timestamps, including some preceding publication.
**The reason for these differences is unresolved.** Do not shift timestamps by
an hour to make them fit the prose, assume every expected run exists, enforce a
fixed 48-hour horizon, or count already-delivered targets as predictive forecasts.
Use the returned offset-aware timestamps and explicit eligibility checks.

## 5. Decision timeline: named markets, not a universal cutoff

Let **D** be the GB calendar delivery day; **D-1** is the preceding calendar day,
including weekends and holidays, not the preceding business day. The following
are separate scenarios. January is on GMT, so these January local clock times
equal UTC; that equivalence must not be generalized to summer.

| Scenario | Published trading deadline on D-1 | Distinction / authority |
| --- | --- | --- |
| EPEX GB hourly day-ahead | 09:20 GMT | EPEX's dated announcement made this effective for delivery from 1 January 2021; results at 09:30 are **not** the bid deadline. [R7] |
| Nord Pool N2EX/GB hourly day-ahead | 09:50 UK time (GMT/BST) | Product specifications effective 10 July 2023, sections 1.2 and 3.1; support page states results by 10:00 GMT. [R8, R9] |
| Nord Pool GB half-hourly day-ahead | 14:30 UK time (GMT/BST) | Separate auction, section 4.1 of those specifications. [R8] |
| EPEX GB half-hourly day-ahead | 15:30 GMT in the reviewed GB overview | Separate later opportunity, not the hourly morning auction. [R10] |

Nord Pool's operative document is dated before January 2026. The EPEX morning
announcement is dated 3 December 2020; its current GB overview corroborates the
separate auction structure but is not a day-by-day January operations archive.
These sources support the stated **normal schedules**; this research has not
verified every January emergency extension or exceptional auction notice. Do
not describe the table as proof of each historical auction's actual close.

**Configurable implementation default, not a confirmed assessment requirement:**
Nord Pool N2EX hourly day-ahead, 09:50 `Europe/London` on D-1. The dated product
specification and support page were rechecked for the backend checkpoint. EPEX
09:20 is a separate supported scenario. A customer can set an earlier internal
`decision_time`; the backend rejects an internal time later than the selected
market gate. A `custom` scenario requires an explicit decision time and does not
claim an exchange deadline. Responses distinguish market gate, internal time,
effective cutoff, timezone, and boundary rule. No internal procurement lead time
has been established by the sources or supplied by the assessment.

Do not confuse these times with:

1. **Forecast issue/publication:** `publishTime`, which can change several times
   each day and must be checked record by record.
2. **Delivery:** `startTime`, the target of the prediction.
3. **BSC Gate Closure:** one hour before each settlement period, for physical
   information submitted to the system operator. This is not a day-ahead auction
   deadline. Elexon's guide separately discusses the Submission Deadline at the
   start of delivery; do not present BSC Gate Closure as the end of all trading.
   [R11]
4. **The customer's internal decision deadline:** potentially earlier than an
   exchange deadline. None was supplied; no arbitrary 08:00, noon, 24-hour lead,
   or operational buffer is being invented.

Forecast accuracy can inform a purchase decision, but these datasets contain no
customer load requirement, risk preference, trading price, or imbalance cost.
Do not claim an optimal purchase volume, financial saving, or trading profit.

## 6. January delivery window and resolution

Construct month boundaries using IANA timezone `Europe/London`, then convert to
UTC. January 2026 has no clock change:

```text
delivery_start_inclusive = 2026-01-01T00:00:00Z
delivery_end_exclusive   = 2026-02-01T00:00:00Z
predicate               = start <= delivery_timestamp < end
```

Retain all 31 x 48 = **1,488 half-hours**. The last is
`[2026-01-31T23:30:00Z, 2026-02-01T00:00:00Z)`, settlement date January 31,
period 48. Do not stop at January 31 midnight, discard it because its publication
is in February, or include February's first delivery interval. Local settlement
dates/periods, UTC storage, and explicit interval ends must remain distinct. [R11]

### Implemented opt-in hourly comparison (explicit modeling assumption)

Keep the native half-hour actuals and hourly forecasts. The default
`comparison_mode=unverified` exposes the data and coverage but withholds scores.
Explicitly selecting `hourly_average_assumption` enables **744 possible hourly
evaluation intervals** under this declared interpretation:

```text
A_hour(t) = (A_halfhour(t) + A_halfhour(t + 30 minutes)) / 2
F_hour(t) = selected WINDFOR generation for startTime == t
interval = [t, t + 1 hour)
```

Both half-hour actuals are mandatory. Average MW, do not sum MW. Hourly energy
would be the sum of each half-hour MW multiplied by 0.5 hours, expressed in MWh.
The final hourly pair uses actuals at January 31 23:00 **and 23:30** and the
forecast targeted at 23:00; it does not require a February 00:00 forecast.

**Explicit assumption gate:** this is an hourly-average interpretation, not a
verified WINDFOR property. The request option (or an explicit deployment setting)
acknowledges that interpretation; responses still say
`forecast_semantics_verified=false` and `available_under_assumption`. Obtain
Elexon/NESO clarification before calling these unconditional interval-average
accuracy scores. If WINDFOR is a point forecast, reassess the comparison rather
than advertising interval-average accuracy. In unverified mode, the two observed
actual half-hours and selected raw hourly forecast remain visible, but errors
and accuracy metrics are null. Cadence alone cannot establish temporal support.

For each native half-hour, preserve its original actual and matching status. A
`:30` slot has no exact native WINDFOR target in the inspected data. Do not label
that as an upstream outage; it is a resolution mismatch. A future step-held or
interpolated half-hour presentation would be a **derived** series requiring its
own approved method and label, not an additional observation. Do not use it to
double the claimed number of native forecast observations.

## 7. Selecting the latest eligible forecast without hindsight

### 7.1 Availability policy

For scenario `s` and delivery day `D`, construct a timezone-aware cutoff
`C_s(D)` at that scenario's clock on **D-1** in `Europe/London`, then convert to
UTC. The same day-ahead cutoff applies to every delivery target on D; it is not
`startTime - 24 hours`.

Version 2 defaults to **no later than**: `publishTime <= C_s(D)`, following the
backend checkpoint's explicit requirement. `cutoff_inclusive=false` restores the
version 1 strict-before policy (`<`). This is a publication-time boundary rule,
not proof that a record timestamped exactly at market closure was actionable.
The strict mode is appropriate for a conservative boundary sensitivity check;
neither rule proves actual receipt. The chosen rule is returned in metadata.

For each target `t`, select:

```text
eligible(t, s) = records where:
    dataset == WINDFOR
    startTime == t
    publishTime <= C_s(local_delivery_day(t))  # use < when cutoff_inclusive=false
    publishTime < t

selected(t, s) = record at maximum publishTime in eligible(t, s)
```

Resolve exact duplicate/conflicting keys as in section 8, and validate the
selected value. If the latest eligible publication is null or conflicted, mark
the target unavailable; do not silently replace it with an older, more convenient
forecast. Select independently per target: the most recent publication globally
may not contain every target. Report selected publication time and age for each.
Do not average different forecast publications.

Actual observations are joined **after** selecting forecasts, never used to choose
which publication looks best. Actuals are ex-post evaluation labels, not inputs
that were knowable at the purchase cutoff.

### 7.2 Publication-window completeness

1. Generate the expected January half-hour grid and the approved evaluation grid.
2. Retrieve FUELHH by settlement date with `fuelType=WIND`.
3. Retrieve WINDFOR by publication windows that include December 31, 2025 and
   reach every selected decision cutoff. The wider research window in section 2.2
   was sufficient to find candidates for all 744 hourly targets in both morning
   scenarios; it is not a general retention/horizon guarantee.
4. For each target with a candidate, ensure **every publication window from that
   candidate's publication through the cutoff** completed successfully. Otherwise
   a later eligible publication could be missing; report selection as incomplete,
   not "latest".
5. The backend uses a bounded, configurable lookback: start the publication search
   `WIND_LOOKBACK_DAYS` calendar days before the first requested delivery day
   (default 3, permitted 1-14). Retrieve through D-1 for the final requested day.
   If no candidate is found, report missing within these returned search bounds;
   do not claim no forecast ever existed. Increasing the lookback is an explicit
   operator action, not an unbounded automatic archive crawl. Never fall back to
   a post-cutoff run. History requests also fetch the target's delivery day to
   display ineligible later publications; they are never included in backtests.
6. Filter delivery targets to January; deduplicate overlapping windows; apply the
   cutoff predicate; join on the approved temporal support. Preserve missing slots.

Do not use `/forecast/generation/wind/latest` or today's unfiltered WINDFOR result
as a shortcut for historical day-ahead eligibility. Keep "latest now/as retrieved"
as a distinct exploratory view with its own label, never the purchase backtest.

### 7.3 What historical publication time can and cannot prove

The reconstruction is **as-published**, conditional on `publishTime` representing
availability. Current historical API responses cannot prove the first moment a
record was accessible, whether it was backfilled, or what a specific trader saw.
No network/processing latency is assumed to be known. Persist today's `retrievedAt`
for provenance; it cannot prove January availability.

For future operational collection, keep immutable `firstSeenAt`/receipt logs and
require both publication and first receipt before the actual decision timestamp.
If an agreed operational lead time is later supplied, set the decision timestamp
earlier than exchange closure and rerun selection; store that lead time explicitly.
Do not silently invent a buffer or claim a zero-latency backtest is an executed
trading strategy. Provider clarification is needed to strengthen historical
availability claims beyond this documented assumption.

## 8. Data quality, missingness, and failure policy

### Identity and revisions

- Actual identity: `(dataset, fuelType, startTime, publishTime)`; forecast identity:
  `(dataset, startTime, publishTime)`. Keep all publications, not just target dates.
- Identical repeated rows, including chunk-boundary overlaps: retain one normalized
  row and count duplicates. Never sum them.
- Same identity with different generation or settlement metadata: quarantine as
  an unresolved conflict; no revision ID exists to justify "last row wins". Fetch
  the narrow window again and/or compare another endpoint of the same dataset;
  preserve conflict evidence and do not count it as a valid evaluation pair.
- Distinct publications for one forecast target are legitimate vintages. Apply
  the as-of rule, not duplicate removal by `startTime` alone.
- For ex-post actuals, use the latest publication present in the extraction
  snapshot; a null/conflicted latest value is unusable, not a reason to fall back.
  Preserve retrieved earlier versions in the in-memory snapshot and the selected
  `actualPublishTime`. This is a latest-available-outturn evaluation, not proof of
  final settlement data. Re-extraction can change results; record the snapshot.

### Validation and gaps

- Reject missing/unparseable identity timestamps, wrong dataset/fuel, invalid
  numeric types, and non-finite values. Null generation remains missing; zero
  is a legitimate observation, not a missing-data marker.
- Cross-check FUELHH settlement date/period with the UTC instant converted to
  `Europe/London`. Unexpected cadence or schema changes require investigation.
- Do not clamp, replace, or drop negative values merely to improve scores. Flag
  them for source/domain review; any exclusion requires an explicit, reported
  rule. No negative generation was found in the inspected responses.
- Maintain separate flags/counts for missing actual, absent pre-cutoff forecast,
  invalid/conflicting row, failed request window, and resolution mismatch.
- No zero-fill, forward-fill across missing targets, interpolation, or substitution
  with another dataset in headline metrics. For hourly actuals, if either half-hour
  is absent the whole hourly evaluation pair is missing.
- Report expected slots, actual slots, eligible forecast targets, valid pairs,
  excluded pairs with reasons, and coverage by day and scenario. Do not let an
  inner join conceal missing observations.

### API failure and unavailable history

- Set connection/read timeouts; use bounded retries for network errors and
  transient 5xx responses. For 429, honor `Retry-After` if provided, otherwise
  bounded exponential backoff with jitter. Initial policy: at most three retries;
  this is an application choice, not an Elexon guarantee.
- Treat 400 as a query/validation defect, not a retry loop. Unexpected 401/403
  should trigger endpoint/access investigation, not invent an API-key requirement.
- A truncated array, stream error, or invalid schema is a failed window. Cache a
  window only after complete parsing and validation; keep failure status separately.
- An empty successful response is distinct from a failed request. Verify filters,
  query neighboring publication windows, and check whether the requested run exists.
  Display unavailable/partial data honestly; never return a successful-looking zero.
- If the required history later becomes inaccessible, **stop the affected analysis
  and report the missing range before changing sources**. Documented same-dataset
  alternatives are `/datasets/FUELHH` and `/datasets/WINDFOR` (same date filters,
  optional `format=json|xml|csv`, JSON with a `data` envelope), and WINDFOR's
  `/forecast/generation/wind/history?publishTime=...` and
  `/forecast/generation/wind/evolution?startTime=...`. [R3]
- A non-stream WINDFOR exact-publication request was reachable in this research;
  the opinionated history/evolution alternatives were documented but not exercised.
  They are possible diagnostics, not proven substitutes for a missing archive.
  Ask Elexon about archive recovery/retention if needed. No explicit retention SLA
  for these streams was found in the reviewed documentation.
- `DGWS/B1440`, FUELINST, and NESO/third-party series must not silently replace
  the mandated sources. Any changed dataset or coverage requires approval and a
  separately documented methodology. January history was accessible here, so no
  substitution was necessary.

For reproducibility, responses retain request URL/parameters, UTC retrieval time, response
checksum, response status, source dataset, native resolution, selected timestamps,
normalization/methodology version, decision scenario, and exclusion counts. Raw
data snapshots, if introduced later, need a deliberate durable storage/ignore policy.
This backend has no disk persistence: successful parsed daily batches are cached
in bounded process memory (default 128 entries, 3,600-second TTL), shared by all
views and cutoff scenarios. Same-key concurrent loads are coalesced. Failed
windows are not cached and fail the entire analysis with 502/503/504 rather than
returning a partial-success score. Restarts cause refetches, not data loss from a
purported persistent store. Separate workers have separate caches.

## 9. Forecast evaluation metrics

Define a valid paired set `S` for one scenario and one explicitly stated
resolution. Let `n = |S|`, `F_i` be the eligible forecast in MW, and `A_i` be actual
MW on the same approved temporal support. Use **forecast minus actual**:

```text
e_i          = F_i - A_i
MAE_MW       = sum(abs(e_i)) / n
RMSE_MW      = sqrt(sum(e_i ** 2) / n)
signedBias_MW = sum(e_i) / n
```

MAE describes typical absolute error; RMSE gives greater influence to large
errors. Positive bias means over-forecasting wind, negative bias means
under-forecasting. Cancellation makes small bias compatible with large MAE.
MAE and RMSE follow standard definitions [R12]; this document fixes the sign
convention explicitly because sources sometimes use actual minus forecast.

For `n == 0`, return null metrics plus a reason and counts, not zero. Evaluate on
the same valid pairs for all three MW metrics. These are equal-duration intervals;
never mix hourly and half-hour errors in one average. Do not round source values
or hourly averages before computing metrics; round only for display.

### Percentage error

For individual pairs with **positive** actual generation:

```text
signedPercentageError_i = 100 * (F_i - A_i) / A_i
absolutePercentageError_i = 100 * abs(F_i - A_i) / A_i
```

At zero actual output, these are undefined (even when both values are zero).
For negative actuals flagged for review, suppress generation-relative percentages
rather than implying an ordinary positive-generation interpretation. Keep such
rows and their review status visible; do not silently alter the MW metric cohort.

If MAPE is shown as a secondary diagnostic, define its subset explicitly as
`S_positive = {i in S: A_i > 0}` and average absolute percentage errors only over
that subset. Report its own count and zero/nonpositive exclusions. With no positive
actuals, MAPE is null. Do not label this subset statistic as full-month MAPE
without qualification.

**Why MAPE is not the headline metric:** division by tiny actual generation can
produce enormous percentages from a small MW miss, letting low-wind periods
dominate the score. It is undefined at zero and unstable near zero. [R12] Do not
add an arbitrary epsilon, cap percentages, or silently remove low-wind periods.
If a near-zero threshold is requested, expose it as an approved sensitivity
analysis with exclusion counts, never an undisclosed numerical fix.

Proposed aggregate relative metric, clearly labeled **WAPE**, on the same `S`:

```text
WAPE_percent = 100 * sum(abs(F_i - A_i)) / sum(abs(A_i))
```

Compute only if `n > 0` and the denominator is greater than zero. WAPE avoids an
individual division by zero but can still be unstable when aggregate actual output
is tiny and gives more influence to high-output periods. It is not MAPE, capacity-
normalized error, a probability, or `100 - accuracy`. Do not report `100 - MAPE`
or `100 - WAPE` as an accuracy percentage.

Display MAE, RMSE, signed bias, WAPE where defined, paired count/coverage,
resolution, source coverage, forecast horizon/age, scenario, and extraction time
together. Compare scenarios on their common valid targets (and show each one's
individual coverage) so missingness does not create a misleading ranking. The
backend evaluates one scenario per request; it does not implement a scenario
ranking or claim statistical independence of hourly errors.

## 10. Backend acceptance checks

The backend suite uses explicitly synthetic fixtures and mocked HTTP responses
to exercise these criteria. Live smoke checks are recorded separately:

1. Contract parsing accepts the two different stream arrays, rejects envelopes
   passed to a stream parser, validates required fields, and catches truncated JSON.
2. FUELHH filters out every non-WIND row; WINDFOR requires no invented fuel filter.
3. January's expected grid contains 1,488 half-hours; first/last delivery starts and
   the February publication of January's final actual are handled correctly.
4. The approved hourly method produces at most 744 pairs and requires both actual
   half-hours, including January 31 23:30. It does not treat missing `:30` forecasts
   as missing native hourly data.
5. Calendar D-1 selection crosses into December 31 for January 1; every target on
   a delivery day uses the same scenario cutoff. UTC parsing is independent of
   the host timezone. If generalized, test both UK daylight-saving transitions.
6. A publication after cutoff cannot be selected. Equality is included by default
   and excluded in strict mode, with tests for both. Multiple targets within one run, missing
   targets in a newer run, and unsorted responses are handled per target.
7. Exact duplicates are idempotent; conflicting same-key values and null latest
   values produce explicit unusable states, not silent older-run fallbacks.
8. No-candidate, failed-window, zero generation, and schema-invalid states remain
   distinct. A failed window prevents a claim that the selected forecast is latest.
9. Hand-calculated, explicitly synthetic **unit-test fixtures** verify MAE, RMSE,
   bias sign, WAPE, zero denominators, and empty cohorts. They are never displayed
   as real Elexon observations or substituted for an unavailable live source.
10. HTTP 400 does not loop; simulated 429/5xx/timeout/truncated-stream tests exercise
    bounded retries and failure reporting. Cache keys include dataset and bounds.
11. Live smoke tests remain separate from deterministic unit tests and report
    upstream outages as such rather than passing on fabricated fallback data.

## 11. Decisions and unresolved limitations

| Item | Status / next action |
| --- | --- |
| January actual/history availability | Confirmed accessible in this research; native hourly WINDFOR, not native half-hour forecasts |
| Market/product and internal purchase deadline | Configurable N2EX 09:50 default, EPEX 09:20 alternative; no claim that either is an assessment requirement or the customer's internal deadline |
| Hourly forecast support | Still unresolved; default scores withheld, opt-in hourly-average assumption returns explicitly conditional metrics |
| Publication timetable/horizon discrepancies | Unresolved; use returned UTC timestamps, do not adjust them to fit documentation; raise with Elexon if needed |
| Historical first accessibility and corrections | No receipt/revision history in these stream fields; backtest remains conditional as-published, not proven trader-available |
| Exceptional January market deadlines | Normal schedules researched; date-specific extensions/outages not exhaustively verified |
| Retention and silent upstream completeness | No retention SLA located; successful coverage probes do not guarantee availability forever or prove every historical vintage is preserved |
| Coverage and economics | GB operationally visible wind only; no Northern Ireland/embedded uplift or unsupported purchase-profit claim |

No provider has been contacted and no deployment platform selected. Backend
dependencies are installed only in the ignored project-local virtual environment.
These choices and limitations remain explicit in the API, tests, and setup notes.

## 12. Authoritative references and research notes

All references were consulted on **24 October 2026**. Dynamic API/schema and
website descriptions reflect that access date; older effective dates below are
important when interpreting January 2026. Links point to the source owners.

- **[R1] Elexon FUELHH stream documentation** — source scope, average MW, settlement
  filters, and request contract:
  <https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream>
- **[R2] Elexon WINDFOR stream documentation** — publication-window filtering and
  unfiltered latest-publication behavior:
  <https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream>
- **[R3] Elexon production OpenAPI definition** — OpenAPI 3.0.4, API info version
  1.0 at inspection; server URL, exact parameters, schemas, responses, and
  same-dataset history/evolution alternatives:
  <https://data.elexon.co.uk/swagger/v1/swagger.json>
- **[R4] Elexon API Guidance** — dataset history, streaming response/no data-return
  limit, error trailers, and 5,000 requests/minute/user:
  <https://bmrs.elexon.co.uk/api-documentation/guidance>
- **[R5] Elexon Wind generation** — hourly forecast, operational-meter coverage,
  comparison to outturn, and stated publication schedule:
  <https://bmrs.elexon.co.uk/wind-generation>
- **[R6] Elexon Generation by fuel type** — limits of embedded/unmetered coverage:
  <https://bmrs.elexon.co.uk/generation-by-fuel-type>
- **[R7] EPEX SPOT, Exchange Council welcomes new timing of GB Day-Ahead auction**
  — 3 December 2020 announcement; change effective for delivery 1 January 2021,
  09:20 GMT auction and 09:30 GMT results:
  <https://www.epexspot.com/en/news/exchange-council-welcomes-new-timing-gb-day-ahead-auction>
- **[R8] Nord Pool Product Specifications, GB Market** — effective 10 July 2023;
  section 1.2/p.3 (UK time), section 3.1/p.9 (09:50 hourly auction), section
  4.1/p.13 (14:30 half-hourly auction), read from the official PDF:
  <https://www.nordpoolgroup.com/4ab576/globalassets/download-center/rules-and-regulations/product-specifications-gb-market.pdf>
  The source index is <https://www.nordpoolgroup.com/en/trading/Rules-and-regulations/>.
- **[R9] Nord Pool, About the N2EX Day Ahead Auction** — modified 26 July 2022;
  next-day physical delivery and distinction between closure and results:
  <https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-n2ex-day-ahead-auction>
- **[R10] EPEX SPOT, Focus GB** — independent exchange auctions and 15:30 GMT
  half-hourly day-ahead market; current overview, not a historical exceptions log:
  <https://www.epexspot.com/en/focus-gb>
- **[R11] Elexon, The Electricity Trading Arrangements: A Beginner's Guide** —
  version 9.0, effective 18 September 2025; settlement periods/local time, physical
  Gate Closure, and the separate Submission Deadline:
  <https://bscdocs.elexon.co.uk/bsc-module/guidance-notes/the-electricity-trading-arrangements-a-beginners-guide>
- **[R12] Hyndman and Athanasopoulos, Forecasting: Principles and Practice,
  third edition**, section 5.8, point-forecast accuracy and percentage-error pitfalls:
  <https://otexts.com/fpp3/toolbox.html#sec-accuracy>
- **[R13] Elexon, Balancing Mechanism Reporting Agent user requirements** —
  appendix C.1 identifies WINDFOR, its BSC Q6.1.17 reference and D-to-D+2 coverage,
  but does not establish an averaging operator for the modern stream's MW field:
  <https://bscdocs.elexon.co.uk/bsc-module/user-requirements-specifications/balancing-mechanism-reporting-agent>
- **[R14] NESO, Day Ahead Wind Forecast resource** — separately published incentive
  forecast, MW units, settlement-period fields and daily publication description;
  not proof of the WINDFOR stream's temporal semantics and not used as replacement data:
  <https://www.neso.energy/data-portal/day-ahead-wind-forecast/day_ahead_wind_forecast>

Research access notes: Elexon's API pages are JavaScript-rendered; their linked
production OpenAPI was parsed directly, API guidance was read in a browser, and
the production site's served explanatory text was inspected for R5/R6. R11's
embedded document content was inspected as well as its visible version metadata.
Nord Pool's PDF was extracted with `pdftotext`; its effective date and relevant
sections were checked. Some ordinary Elexon web-page requests and an EPEX 2025
brochure download returned HTTP 403; those inaccessible pages/PDF were **not**
used as substantive evidence. There was no Elexon data-API availability failure
for the valid historical probes recorded above.

AI assistance: this specification was researched and drafted with the coding
assistant, model `gpt-6-astra`. AI output is not a data source; the factual claims
are tied to the official references and live probes above. Project-wide AI
disclosure is included in the root `README.md`.

## 13. Backend decision record and verification

### Evidence review and decisions (24 October 2026)

1. **Market policy:** R8 sections 1.2 and 3.1 were re-read from the official PDF;
   R9 corroborates next-day delivery, 09:50 closure and later result publication.
   R7 supports a distinct EPEX 09:20 scenario. These justify the configurable
   `n2ex` default, not a claim about the assessment/customer's internal deadline.
   The response carries `market_gate_time`, `internal_decision_time`, and
   `effective_decision_time` separately. Earlier internal times are configurable;
   there is no invented latency buffer. Exceptional January deadlines remain
   unverified, and normal schedules must not be presented as an operations log.
2. **Cutoff equality:** the backend checkpoint says "no later than", so the
   implemented default is inclusive. The original strict-before policy remains
   available via `cutoff_inclusive=false`; both boundary behaviors are tested.
   Neither makes an exactly-at-gate publication proof of executable availability.
3. **Forecast quantity:** rechecking R3 confirms nullable integer `generation`
   without an averaging definition. R5 establishes hourly MW forecasts, not the
   operator defining each value's temporal support. Additional inspection of
   R13 did not resolve that operator. R14 is a different, settlement-period
   forecast publication, so its metadata must not be transferred to WINDFOR.
   No definitive point/interval-average interpretation was verified. The hourly
   cadence of the live data cannot supply that missing definition.
4. **Comparison:** preserve the observed hourly forecast without resampling.
   Actual hourly mean MW is well-defined from its two equal-duration half-hours.
   Default `unverified` mode exposes both with counts but no calculated errors.
   Explicit `hourly_average_assumption` mode interprets the forecast as mean MW
   over the same `[t,t+1h)` interval, so the conditional comparison uses equivalent
   hourly quantities and units **under that disclosed assumption**. It is not an
   empirically established equivalence. All responses retain the unresolved
   semantics warning; no unconditional or half-hour forecast accuracy is claimed.
5. **Availability:** the latest eligible published key is reconstructed within
   the reported search bounds. First public accessibility, backfills, and trader
   receipt are not verified. An empty bounded search is not a claim about all
   history. `retrieved_at` is extraction provenance, not January receipt evidence.
6. **Practical implementation:** daily source windows, a bounded in-memory TTL
   cache, typed source/response models, pure selection/metric functions, and a
   small FastAPI layer. No database, disk persistence, alternative dataset, or
   fixture fallback is needed. Invalid required source fields fail the window;
   numeric nulls and legitimate missing slots remain explicit. Conflicts preserve
   the key but suppress an arbitrary winning value. Failures prevent a successful
   partial "latest" analysis. Error-reason counts can overlap across one hour.

### Live backend smoke check

A temporary local Uvicorn process was started and exercised over actual HTTP;
its upstream client used **real Elexon requests**, with no mocked transport or
fixture substitution. The process was stopped after verification.

- January source batches were retrieved on 24 October 2026 between
  **17:40:07 and 17:40:12 UTC** across 64 daily request windows.
- Health, summary, series, errors, and publication history all returned HTTP 200.
- The month had 1,488 usable actual half-hours, 744 actual hourly means, and
  744 usable eligible hourly forecasts for the default N2EX scenario; there were
  no same-key conflicts or duplicates in this extraction.
- Default summary had `status=semantics_unverified`, zero evaluated pairs, and
  null accuracy metrics despite full data-pair availability. This is intentional.
- Explicit research opt-in exercised conditional scores for 744 pairs; every
  selected publication was checked against its cutoff and delivery target.
  No numeric score is promoted here as verified interval-average accuracy.
- The final January 23:30 actual component was present. Error analysis returned
  31 daily groups. January 1 00:00 publication history returned 24 vintages and
  selected `2025-12-31T09:30:00Z` for the N2EX cutoff, excluding later publications.
- Repeated views reused validated cached batches and retained their original
  retrieval timestamps. These counts describe that extraction, not a hardcoded
  API success state or a guarantee of future upstream availability.

Automated checks are run separately with synthetic fixtures and an outbound
network guard; commands are in `backend/README.md`. They are not substitutes
for the live check above. Frontend implementation remains unchanged.

### Automated verification snapshot

On Python 3.13.5 in the isolated backend virtual environment:

- `python -m pytest --cov=app --cov-report=term-missing -q`: **85 passed**;
  coverage.py reported **99% combined statement/branch coverage**. This measures
  exercised code, not certainty about upstream data semantics.
- `ruff check app tests` and `ruff format --check app tests`: passed.
- `mypy app`: passed for all 15 application source files.
- `python -m pip check`: no broken requirements.
- From `frontend/`, `npm run lint` and `npm run build`: passed. SHA-256 checks
  of every pre-existing non-generated frontend file matched the inspection baseline.

The added shutdown regression exposed a cancelled-before-start task retaining
an in-flight cache entry; cleanup now clears that state after awaiting cancelled
tasks. The failing test was retained, the cause fixed, and the full suite rerun.
