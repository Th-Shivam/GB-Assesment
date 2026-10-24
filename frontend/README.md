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

In development, `VITE_API_BASE_URL=/backend` uses the Vite proxy to forward requests
to `BACKEND_PROXY_TARGET=http://127.0.0.1:8000`. If `VITE_API_BASE_URL` is omitted in
development, the same `/backend` proxy default is used.

For a production build, set `VITE_API_BASE_URL` explicitly to the deployed backend
origin, for example `https://api.example.com`. Production requires an absolute HTTPS
URL; it does not fall back to `/backend`, localhost, or any other development target.
The URL is normalized for trailing slashes and may include a server path prefix, but
it must not include credentials, a query string, or a fragment. The frontend appends
`/health` and `/api/v1/wind/...` to this root. A missing or invalid production value
fails the build with a configuration error; the runtime client also retains a visible
defensive configuration-error state. This variable is public build-time configuration;
no credentials belong in it.

The local Docker Compose stack uses a separate explicit `compose` build mode with the
same `/backend` browser path. Its Nginx runtime reverse-proxies that path to the
internal `backend:8000` service, so the browser never needs to resolve a Docker
service name. See `../docs/docker.md` for startup and health-check commands.

For public deployment preparation, use the checked-in `vercel.json` from a Vercel
project whose root directory is `frontend/`. Set `VITE_API_BASE_URL` separately for
Vercel Preview and Production to the corresponding absolute HTTPS backend origin;
see `../docs/deployment.md`. Vercel is not configured to proxy `/backend` to an
arbitrary backend.

### Separate-origin CORS requirement

The local `/backend` proxy avoids browser CORS. When the frontend and backend use
different production origins, the backend deployment must allow the exact frontend
origin in its CORS policy, including `OPTIONS` preflight requests. Do not use `*` as
a substitute for an origin allowlist. The current backend does not add CORS headers;
backend CORS configuration belongs to the later deployment checkpoint and is not
changed here. A same-origin reverse proxy can avoid this requirement.

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

Representative production build:

```sh
VITE_API_BASE_URL=https://api.example.com npm run build
```

The build output must be generated with the actual deployed API origin. Verify that
the generated files contain neither `127.0.0.1` nor `localhost` before publishing.

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
