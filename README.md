# Kerala Assembly Election 2026 Live Tracker

A production-ready single-page dashboard for tracking live results from the official Election Commission of India results site for selected Kerala assembly constituencies.

The app is intentionally built with a backend scraper because ECI result pages can change event paths, may not allow browser-side CORS, and should not be fetched directly from every open browser tab.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, TanStack Query
- Backend: Node.js, Express, Cheerio
- Shared model package: TypeScript
- Source: `https://results.eci.gov.in`

## Folder Structure

```text
.
├── apps
│   ├── backend
│   │   ├── src
│   │   │   ├── eci
│   │   │   │   ├── http.ts
│   │   │   │   ├── parser.ts
│   │   │   │   ├── service.ts
│   │   │   │   └── text.ts
│   │   │   ├── cache.ts
│   │   │   ├── config.ts
│   │   │   ├── keralaConstituencies.ts
│   │   │   ├── routes.ts
│   │   │   └── server.ts
│   │   └── .env.example
│   └── frontend
│       ├── src
│       │   ├── App.tsx
│       │   ├── api.ts
│       │   ├── export.ts
│       │   ├── hooks.ts
│       │   ├── main.tsx
│       │   └── styles.css
│       └── vite.config.ts
└── packages
    └── shared
        └── src/index.ts
```

## Local Setup

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
npm run build --workspace @kerala-election/shared
```

Start the API:

```bash
npm run dev:backend
```

Start the frontend in a second terminal:

```bash
npm run dev:frontend
```

Open `http://localhost:5173`.

## Configuration

Backend configuration lives in `apps/backend/.env`.

```env
PORT=4100
FRONTEND_ORIGIN=http://localhost:5173
ECI_BASE_URL=https://results.eci.gov.in
ECI_ELECTION_PATH=
ECI_KERALA_STATE_PAGE=
ECI_KERALA_STATE_CODE=
CACHE_TTL_SECONDS=25
DEFAULT_FAVORITES=thrissur,ernakulam,palakkad,nemom
REQUEST_TIMEOUT_MS=12000
```

The app now supports runtime source URL updates through an admin-only API and dashboard panel. Environment variables seed the initial values; admin updates are persisted to `data/source-config.json` and take effect without code changes.

Current seeded source values:

```env
ECI_BASE_URL=https://results.eci.gov.in
ECI_CONSTITUENCY_LIST_URL=https://results.eci.gov.in/ResultAcGenMay2026/statewiseS111.htm
ECI_CANDIDATE_DETAIL_URL_TEMPLATE=https://results.eci.gov.in/ResultAcGenMay2026/candidateswise-S11{constituencyNumber}.htm
```

The detail URL template supports:

- `{constituencyNumber}`: unpadded number, such as `2`
- `{constituencyNumberPadded}`: padded number, such as `002`
- `{constituencyId}`: normalized id, such as `ramnagar`

Open the dashboard, expand **Source URLs**, enter the admin password, update the base URL, all-constituency page URL, individual result page URL template, and refresh seconds, then save.

Current admin password:

```text
ldfudf#2026
```

You can also update sources through the API:

```bash
curl -X PUT http://localhost:4100/api/admin/source-config \
  -H "Authorization: Bearer ldfudf#2026" \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://results.eci.gov.in",
    "constituencyListUrl": "https://results.eci.gov.in/ResultAcGenMay2026/statewiseS111.htm",
    "candidateDetailUrlTemplate": "https://results.eci.gov.in/ResultAcGenMay2026/candidateswise-S11{constituencyNumber}.htm",
    "refreshIntervalSeconds": 30
  }'
```

When ECI publishes the Kerala 2026 result event, set one of these as a fallback discovery path if needed:

```env
ECI_ELECTION_PATH=/SomeEciElectionFolder/
```

or, if you know the exact Kerala state page:

```env
ECI_KERALA_STATE_PAGE=/SomeEciElectionFolder/statewiseS11.htm
```

If ECI uses a known Kerala state code for the event, add it to improve discovery:

```env
ECI_KERALA_STATE_CODE=S11
```

The app does not hardcode Kerala 2026 URLs. Until the ECI event path is configured, the backend returns the Kerala constituency list for selection and clearly marks live source data as pending.

## API

- `GET /api/health`
- `GET /api/source-config`
- `PUT /api/admin/source-config`
- `GET /api/constituencies`
- `GET /api/results/summary?ids=thrissur,ernakulam`
- `GET /api/results/:constituencyId`

Responses use the shared models in `packages/shared/src/index.ts`.

## How Source Discovery Works

1. The backend reads the runtime source config from `data/source-config.json`, falling back to environment values.
2. It fetches `constituencyListUrl`.
3. The parser discovers ECI pagination links such as `statewiseS111.htm` through the matching event pagination pages and fetches every page in the grid.
4. The parser extracts constituency numbers and names from each table page, then deduplicates by constituency number.
5. For every parsed constituency number, the backend builds the candidate-detail URL from `candidateDetailUrlTemplate`.
6. Example: template `https://results.eci.gov.in/ResultAcGenMay2026/candidateswise-S11{constituencyNumber}.htm` and constituency number `2` maps to `https://results.eci.gov.in/ResultAcGenMay2026/candidateswise-S112.htm`.
7. When a tracked constituency is refreshed, the backend fetches that mapped detail page and extracts candidate results.

## Parsing Strategy

ECI pages are table-based, but exact class names and nesting can differ between election events. The scraper therefore:

- extracts visible table rows instead of depending on a single CSS class,
- builds column maps from header text,
- normalizes whitespace and numeric text,
- searches for known labels such as candidate, party, EVM, postal, total, percentage, margin, and status,
- supports the newer card-style `candidateswise` pages used by ECI in the November 2025 sample,
- logs detail-page parsing failures with constituency id and source URL,
- keeps parser functions separate from HTTP and Express routing for easier tests and fixes.

## Refresh and Caching

The frontend refreshes every 30 seconds via TanStack Query and disables manual refresh while a refresh is already in progress. The backend caches ECI responses for `CACHE_TTL_SECONDS`, defaulting to 25 seconds, to avoid hammering the official site while still supporting the required polling interval.

## Dashboard Features

- searchable multi-select constituency picker,
- local storage persistence,
- configurable default favorites,
- candidate-wise result cards,
- highlighted leader and second-position candidate,
- margin and vote change indicators compared with the previous successful poll,
- leader-change visual banner and optional sound alert,
- manual refresh,
- last successful sync time,
- JSON and CSV export,
- dark mode,
- graceful error banner when live source pages are unavailable.

## Production Build

```bash
npm run build
npm run start --workspace @kerala-election/backend
```

## Render Deployment

This repository includes `render.yaml` for a two-service Render deployment:

- `api-election-results`: Render Web Service running the Express backend.
- `kerala-election`: Render Static Site serving the Vite frontend from `apps/frontend/dist`.

Both Render services must use the repository root as their Root Directory because the frontend depends on the shared workspace package in `packages/shared`.

```text
Root Directory: .
```

The frontend reads the backend endpoint from this build-time environment variable:

```env
VITE_API_BASE_URL=https://api-election-results.onrender.com
```

The backend allows the deployed static frontend through:

```env
FRONTEND_ORIGIN=https://kerala-election.onrender.com
```

If you rename either Render service, update both values in `render.yaml` before syncing the Blueprint. For local development, leave `VITE_API_BASE_URL` unset to use the Vite `/api` proxy, or copy `apps/frontend/.env.example` and set it explicitly.

If you configure the frontend Static Site manually in the Render dashboard, use:

```text
Build Command: npm ci && npm run build:frontend
Publish Directory: ./apps/frontend/dist
```

Deploy the backend and frontend as separate services, or serve the generated frontend assets from your preferred static host. Keep the backend close to the users if possible, but keep the ECI cache enabled so repeated dashboard refreshes do not multiply source traffic.
