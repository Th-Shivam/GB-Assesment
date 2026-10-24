# Wind Desk deployment preparation

This checkpoint prepares, but does not execute, a public deployment. No account was
connected, no service was created, and no public URL is claimed.

## Recommended architecture

Use **Vercel for the Vite frontend** and a **Docker-capable Render web service for the
FastAPI backend**:

```text
Vercel static frontend
  └── HTTPS fetches to VITE_API_BASE_URL
        └── Render Docker web service
              └── Elexon BMRS on analytics requests
```

This keeps the existing frontend build and backend Docker image, avoids introducing a
database or queue, and separates static CDN delivery from Python runtime concerns. The
trade-off is that separate origins require an exact backend CORS allowlist and the
assessment/free backend tier can cold-start. For a real always-on service, use a paid
backend instance; the committed `render.yaml` uses Render's `free` plan only as a
low-cost assessment/demo default.

The local same-origin Nginx Compose architecture remains available in
`docs/docker.md`. Vercel does not automatically proxy `/backend` to an arbitrary
backend; the recommended public setup uses the backend's HTTPS origin explicitly.

## Part A — Vercel frontend

The Vercel project should use the existing repository with **Root Directory** set to
`frontend/`. `frontend/vercel.json` makes the build and SPA behavior explicit:

- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- Unknown browser paths rewrite to `/index.html` for the React app shell.

Configure `VITE_API_BASE_URL` in the Vercel project settings before every deployment:

| Vercel environment | Value |
| --- | --- |
| Preview | The HTTPS backend origin used by preview testing, such as `https://winddesk-backend-preview.onrender.com` |
| Production | The stable HTTPS backend origin, such as `https://winddesk-backend.onrender.com` |
| Development | Local `.env` only; use `/backend` with the Vite proxy |

Use the Vercel UI or CLI to set the variable for the intended environment, then create
a new deployment. Do not set `BACKEND_PROXY_TARGET` in Vercel; it is local Vite proxy
configuration and is not part of the static runtime. `VITE_API_BASE_URL` is public
build-time configuration and must contain no credentials or secrets.

The normal `npm run build` path rejects a missing, non-HTTPS, credential-bearing,
query-bearing, or fragment-bearing production API URL. It does not fall back to
`/backend`, `localhost`, or `127.0.0.1`.

## Part B — Render backend

`render.yaml` describes one Docker web service:

- Docker context: `backend/`
- Dockerfile: `backend/Dockerfile`
- Health check: `/health`
- Default market: `n2ex`
- Default comparison mode: `unverified`
- CORS origins: supplied manually as `WIND_CORS_ORIGINS`

The Dockerfile now honors Render's injected `PORT` while retaining port `8000` for
local Compose. The effective process command is:

```sh
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

The Render service must expose the platform-provided port; do not hard-code a public
port in the frontend. Verify the service with:

```sh
curl --fail https://<backend-host>/health
```

The health response proves process liveness only. It does not prove Elexon access,
January data completeness, or a warm cache. The first summary/series/errors request
can be slow because the backend performs bounded daily retrievals. The cache is
process memory, not durable storage; restarts and redeploys refetch source windows.

### Render free-tier warning

The committed Blueprint uses `plan: free` for assessment/demo preparation. Render's
current free web-service documentation describes 512 MB RAM, 0.1 CPU, spin-down after
15 minutes without inbound traffic, approximately one minute to wake, and a monthly
free-instance hour allowance. Treat this tier as a cold-start/demo target rather than
an availability commitment; change the plan to a paid instance for dependable use.
Do not add a database or persistent disk for this bounded January analysis.

## Part C — CORS and connectivity

The recommended separate-origin pattern requires the backend setting:

```text
WIND_CORS_ORIGINS=https://<production-vercel-origin>
```

For more than one exact origin, use a comma-separated value:

```text
WIND_CORS_ORIGINS=https://winddesk.vercel.app,https://preview.example.com
```

The backend CORS implementation allows only those exact HTTP(S) origins, handles GET
preflight requests, and does not enable credentials or wildcard origins. Set a stable
preview/custom domain if preview deployments need a persistent allowlist entry; do not
blindly allow every generated preview URL.

The alternative is a same-origin reverse proxy: route `/backend/*` from the frontend
origin to the backend and set `VITE_API_BASE_URL=/backend` only in that deliberately
configured build. This is how local Nginx Compose works. Vercel will not do this for
an arbitrary backend unless explicit rewrites/proxy infrastructure is configured and
verified; the recommended public setup therefore uses the absolute HTTPS backend URL.

## Deployment sequence after account access is authorized

1. Create/import the Render Blueprint from `render.yaml`.
2. Set `WIND_CORS_ORIGINS` to the exact intended Vercel origin; leave the comparison
   mode `unverified` unless the assessment explicitly approves the assumption.
3. Deploy the backend and verify `/health` from the public HTTPS URL.
4. Create/import the Vercel project with root directory `frontend/`.
5. Set Preview and Production `VITE_API_BASE_URL` values to the appropriate backend
   HTTPS URL, then deploy.
6. Verify the frontend page, `/health`, a January `/summary` request, default
   unavailable-metric messaging, and explicit conditional labeling.
7. If the frontend origin changes, update `WIND_CORS_ORIGINS` and redeploy the
   backend. Do not solve a CORS failure by adding `*`.

## Methodology checks that remain mandatory

- Default accuracy metrics remain unavailable because WINDFOR forecast averaging
  semantics are unverified.
- Explicit `hourly_average_assumption` results remain conditional and must retain
  `forecast_semantics_verified=false`.
- `publishTime` reconstructs published records; it does not prove actual trader receipt
  or executable availability.
- GB operationally visible wind is not a complete UK wind total, and no procurement
  savings or trading-profit claim is made.
