# Wind Desk frontend

Professional React/Vite dashboard for the January 2026 GB Wind Forecast Analytics
assessment. It connects to the real FastAPI backend; it contains no fixture or fake
production-data mode.

## Local setup

From `frontend/`:

```sh
npm install
cp .env.example .env
npm run dev
```

Start FastAPI separately from `backend/`:

```sh
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The default `VITE_API_BASE_URL=/backend` uses the Vite proxy to forward requests to
`BACKEND_PROXY_TARGET=http://127.0.0.1:8000`. Set `VITE_API_BASE_URL` to an absolute
HTTP(S) API root for a separately hosted backend. This variable is public build-time
configuration; no credentials belong in it.

## Dashboard behaviour

- Default requests explicitly use `comparison_mode=unverified`; accuracy metrics are
  shown as unavailable rather than as zeros.
- The policy panel can opt into `hourly_average_assumption`. All resulting MAE,
  RMSE, bias and daily error values remain labelled conditional because WINDFOR's
  point-versus-hour-average semantics are not verified.
- Actual generation is the available-hour mean of FUELHH half-hour MW observations;
  forecast generation is the separate available-hour mean of native WINDFOR targets.
  These cards are not energy totals and are not silently zero-filled.
- Publication history shows eligible and post-cutoff vintages. `publishTime` is
  presented as an as-published reconstruction, not proof of trader receipt.
- Timestamps use the backend's UTC contract and are formatted explicitly as UK local
  time. January 2026 is GMT; the formatter retains Europe/London DST rules if reused.

## Checks

```sh
npm run lint
npm run test
npm run typecheck
npm run build
```

Unit tests use synthetic in-memory responses only and block outbound network calls.
They cover API schema handling, typed upstream failures, missing metrics, conditional
labels, UK timezone formatting, and chart gaps. A manual browser smoke check against
the local FastAPI and Vite servers is part of this checkpoint; no browser automation
dependency is required for the unit-test suite.

## Structure

```text
src/api/             Zod schemas and typed FastAPI client
src/components/      Policy, KPI, chart, table, feedback, methodology UI
src/hooks/            Abortable resource loading and retry state
src/lib/              Formatting, chart geometry and analysis display rules
src/test/             Explicitly synthetic test fixtures and setup
```
