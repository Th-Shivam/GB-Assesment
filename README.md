# GB Wind Forecast Analytics

Assessment project for national wind forecast analysis of January 2026 delivery.
The backend uses **Elexon BMRS FUELHH (`fuelType=WIND`) and WINDFOR**. It covers
operationally visible Great Britain wind, not every UK/embedded generator.

## Current checkpoint

- FastAPI backend with health, summary, series, publication history, and error analysis.
- Published-as-of forecast selection, configurable decision policy, explicit missing-data
  reporting, and a bounded in-memory upstream cache.
- Synthetic/mocked automated tests, linting, and Python type checking.
- The existing React/Vite frontend is unchanged; no dashboard is implemented yet.
- Docker, deployment, repository anonymity review, and the video demo remain later work.

See **[backend setup and API examples](backend/README.md)** and
**[data methodology](docs/data-methodology.md)** before interpreting results.

## Important interpretation limits

N2EX's 09:50 UK-time D-1 market closure is a **configurable analytical default**,
not a confirmed customer procurement requirement. An earlier internal decision
time can be supplied. Publication timestamps do not prove trader receipt.

FUELHH gives half-hour mean MW; WINDFOR supplies hourly forecast targets, but its
point-versus-average semantics have not been conclusively verified. Therefore
accuracy scores are **withheld by default**. The explicit
`comparison_mode=hourly_average_assumption` option computes conditional hourly
scores against the mean of the two actual half-hours and labels that assumption
in every response. No hourly forecast is silently duplicated into half-hours.

## AI tooling disclosure

The coding assistant in this app, using model **`gpt-6-astra`**, assisted with
official-source research, methodology drafting, backend implementation, tests,
and documentation. Source claims were checked against cited official documents
and live Elexon requests. AI-generated text is not treated as data or authority.
Synthetic test fixtures are explicitly labeled and never used as live fallback data.
