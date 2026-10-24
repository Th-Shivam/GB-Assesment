# Local Docker integration

Checkpoint C runs Wind Desk as two containers on one private Compose network:

```text
browser ── http://localhost:8080 ──> frontend (Nginx, :8080)
                                      │
                                      └── /backend/* ──> backend:8000
                                                          │
                                                          └── Elexon BMRS (on analytics requests)
```

The browser only talks to the frontend origin. It does **not** resolve the internal
Compose service name `backend`, so no browser-facing CORS request is required for the
local stack. Nginx performs the private-network reverse proxy and strips the
`/backend` prefix before forwarding to FastAPI.

## Start and stop

From the repository root:

```sh
docker compose build
docker compose up -d
docker compose ps
```

Open the dashboard at `http://localhost:8080`.

Useful checks:

```sh
# Frontend container health endpoint
curl --fail http://localhost:8080/healthz

# Backend health directly on the host-published port
curl --fail http://localhost:8000/health

# Backend health through the browser-facing same-origin reverse proxy
curl --fail http://localhost:8080/backend/health

# Logs
docker compose logs -f frontend backend
```

Stop and remove the local containers/network with:

```sh
docker compose down
```

`docker compose down -v` is not needed for this stack because it has no named data
volumes; avoid it unless a future checkpoint adds state that should be deliberately
removed.

## Environment and API URL handling

The backend has no required secret. Optional non-secret settings can be supplied in a
shell or an uncommitted root `.env`, for example:

```sh
WIND_DEFAULT_MARKET=epex docker compose up -d --build
```

The Compose frontend build passes `VITE_API_BASE_URL=/backend` and uses the explicit
Vite `compose` mode. This is not the public production mode: it is a deliberate
same-origin local build whose `/backend/` requests are reverse-proxied by Nginx.

The ordinary production build remains strict:

```sh
VITE_API_BASE_URL=https://api.example.com npm --prefix frontend run build
```

It requires an absolute HTTPS backend URL and does not fall back to localhost or the
development proxy. No credentials or secrets belong in `VITE_API_BASE_URL` or the
Compose build arguments.

## Health and startup ordering

- The backend image exposes `8000`, binds Uvicorn to `0.0.0.0`, and has a Python
  healthcheck for `/health`.
- The frontend image exposes `8080`, runs the unprivileged Nginx image, and has a
  `/healthz` healthcheck.
- Compose waits for the backend healthcheck before starting the frontend container.
- `/health` reports FastAPI process liveness only; it does not prove Elexon access or
  January data completeness.
- The first analytics request may be slow because the backend retrieves daily Elexon
  windows into its bounded process-memory cache.

## Data verification expectations

The local stack uses the real backend and therefore the real Elexon requests when an
analytics endpoint is called. It does not add fixture fallback data. In the default
mode, the dashboard must display accuracy metrics as unavailable because WINDFOR
averaging semantics remain unverified. Enabling the dashboard's explicit
`hourly_average_assumption` option produces metrics labelled conditional; it never
changes `forecast_semantics_verified=false`.

This local HTTP setup is not a public deployment. A separately hosted frontend and
backend will need an explicit backend CORS allowlist unless the deployment uses a
same-origin reverse proxy. That configuration is outside this checkpoint.
