# ARGUS — Dashboard (Next.js 16)

The control-plane dashboard for [ARGUS](https://github.com/Aaditya1273/Argus) —
AI Agent Runtime Governance & Cost Firewall. Live agent oversight, cost
firewall, governance plugins, Agent DNA, MCP client connection hub, and the
**DataHub Context** page (metadata-aware governance).

## Getting Started

### 1 — Point the dashboard at a backend

The dashboard reads the ARGUS Go backend URL from env vars (defaults to the
hosted Render backend when unset, so the live deployment works unchanged):

```bash
cp .env.example .env.local        # then edit

# Server-side proxies (API routes + rewrites) — runtime
ARGUS_BACKEND_URL=http://localhost:8080
# Client bundle (WebSockets, MCP deep links) — build time
NEXT_PUBLIC_ARGUS_BACKEND_URL=http://localhost:8080
```

For login you also need NextAuth + Postgres vars (see `.env.example`).

### 2 — Run

```bash
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3 — Build & production

```bash
npm run build && npm start
```

Self-hosted deployments (Docker Compose, DataHub wiring, production exposure)
are documented in the repo root: [`SELF_HOSTING.md`](../SELF_HOSTING.md).

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/cost-firewall` | Burn rate, budget donut, enforced policies |
| `/mission-control` | Live agent table + WebSocket state (pause / resume / kill) |
| `/agent-dna` | Behavioral baselines, drift detection, anomaly score |
| `/incidents` | Blocked/dead agents derived from runtime state |
| `/datahub` | **DataHub Context** — catalog search, asset metadata, lineage, governance event log |
| `/policies` | Cost enforcement policies (CRUD) |
| `/governance` | Active detection plugins |
| `/plugins` | One-click MCP connection for 10+ AI clients + live session stream |
| `/settings` | SigNoz health & OTel exporter config |
| `/login` · `/connect` | Google sign-in · OAuth 2.1 consent + budget picker |

## Architecture

- **API routes** (`src/app/api/argus/*`) proxy REST calls to the ARGUS Go
  backend, with the base URL resolved from `src/lib/config.ts`.
- **Realtime** — pages connect a WebSocket directly to
  `{backend}/api/v1/argus/ws` with exponential-backoff reconnect.
- **Auth** — NextAuth v5 (Google) with Prisma + Postgres adapter.
