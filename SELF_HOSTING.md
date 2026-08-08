# 🏠 Self-Hosting ARGUS

This guide walks through deploying the **full ARGUS stack** — Go backend
(control plane) + Next.js dashboard — on your own infrastructure, including the
optional **DataHub metadata-aware governance** integration.

Everything is configurable via environment variables; **no code changes are
required**. When a variable is unset, ARGUS falls back to sensible defaults (the
dashboard defaults to the hosted Render backend so existing deployments keep
working unchanged).

---

## 1. What you're running

| Service | Tech | Ports | Purpose |
|---|---|---|---|
| `argus-control-plane` | Go 1.24+ | `8080` (REST/MCP/WS), `4317`/`4318` (OTLP) | Governance engine, cost firewall, MCP server, OAuth 2.1 AS, WebSocket gateway |
| `argus-frontend` | Next.js 16 | `3000` | Dashboard (Mission Control, Cost Firewall, DataHub, Plugins, …) |
| DataHub (optional) | Acryl Cloud / OSS | — | Metadata catalog that ARGUS checks before governed tool calls |

---

## 2. Option A — Docker Compose (recommended)

```bash
git clone https://github.com/Aaditya1273/Argus.git
cd Argus

# Build & start backend + frontend
docker compose -f docker-compose.prod.yaml up --build
```

- Dashboard: **http://localhost:3000**
- MCP endpoint (connect Claude/Cursor/…): **http://localhost:8080/api/v1/mcp**
- Health check: `curl http://localhost:8080/api/v1/health`

> The compose file publishes OTLP ports `4317`/`4318` so agents can ship
> telemetry to the control plane; export it onward to SigNoz Cloud with
> `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`.

## 3. Option B — Run natively

### Backend (Go)

```bash
# backend env (see .env.example)
export ARGUS_BUDGET_LIMIT=100.0
export ARGUS_PUBLIC_BASE="http://localhost:8080"
export ARGUS_DASHBOARD_BASE="http://localhost:3000"

go run cmd/argus-server/main.go   # listens on :8080
```

### Frontend (Next.js)

```bash
cd frontend
cp .env.example .env.local        # then edit

# Point the dashboard at your backend
export ARGUS_BACKEND_URL="http://localhost:8080"          # server-side (runtime)
export NEXT_PUBLIC_ARGUS_BACKEND_URL="http://localhost:8080" # client bundle (build time)

npm install --legacy-peer-deps
npm run dev                       # http://localhost:3000
# or: npm run build && npm start
```

> `ARGUS_BACKEND_URL` and `NEXT_PUBLIC_ARGUS_BACKEND_URL` replace every
> hardcoded backend reference (API proxies, WebSockets, MCP deep links, OAuth
> discovery) — set both to the same value. Unset → defaults to
> `https://argus-xhgx.onrender.com`.

### Login (optional)

Login uses NextAuth with Google OAuth and a Postgres database (Prisma):

```bash
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
export DATABASE_URL="postgresql://user:pass@host:5432/argus"

cd frontend && npx prisma db push   # create tables once
```

---

## 4. Enabling DataHub metadata-aware governance

ARGUS acts as an **MCP client** to a DataHub MCP Server. When configured, every
governed tool call is checked against **ownership, lineage-PII, GDPR/HIPAA
policies, data quality, and deprecation** before execution (fail-closed), and
decisions are written back as audit tags.

### Backend side (ARGUS)

```bash
export DATAHUB_MCP_URL="https://<tenant>.acryl.io/integrations/ai/mcp"  # Acryl Cloud
# or self-hosted DataHub:  http://<gms-host>:8080/mcp
export DATAHUB_TOKEN="<datahub personal access token>"
export DATAHUB_MUTATION_ENABLED="true"   # enables audit write-back (add_tags)
# export DATAHUB_HTTP_TIMEOUT=15s
```

### DataHub MCP server side (set on the DataHub process, NOT ARGUS)

```bash
TOOLS_IS_MUTATION_ENABLED=true     # add_tags/remove_tags/add_owners/set_domains/update_description
TOOLS_IS_USER_ENABLED=true         # get_me
DATA_QUALITY_TOOLS_ENABLED=true    # get_dataset_assertions
```

### Verify

```bash
curl -s http://localhost:8080/api/v1/argus/datahub/status | jq
# → { "configured": true, "status": "active", "plugins": ["DataHub Ownership", ...] }
```

Search the catalog and inspect lineage from the dashboard's **DataHub Context**
page, or seed demo metadata:

```bash
python examples/datahub/seed_metadata.py \
  --endpoint "$DATAHUB_MCP_URL" --token "$DATAHUB_TOKEN"
```

Without these variables the integration is a **no-op** — everything else works
exactly as before. See [`examples/datahub/README.md`](examples/datahub/README.md).

---

## 5. Exposing to the internet (production)

- Point a reverse proxy (Caddy / nginx / Traefik) at `:8080` and `:3000`, or use
  your host (Render, Railway, VPS) with TLS termination.
- Update `ARGUS_PUBLIC_BASE` / `ARGUS_DASHBOARD_BASE` to the public URLs so the
  OAuth consent flow and MCP discovery return reachable addresses.
- Rebuild the frontend with `NEXT_PUBLIC_ARGUS_BACKEND_URL=https://your-public-backend`
  so browser-side connections (WebSockets, MCP deep links) hit the public URL.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Dashboard shows "Backend offline" | `ARGUS_BACKEND_URL` points somewhere unreachable; verify the Go server is up (`curl /api/v1/health`) |
| WebSocket shows "Reconnecting…" | Browser hits `NEXT_PUBLIC_ARGUS_BACKEND_URL` — rebuild with the public https URL, and ensure the backend allows WS upgrades |
| DataHub page shows "Not configured" | `DATAHUB_MCP_URL` / `DATAHUB_TOKEN` unset on the backend — see section 4 |
| OAuth /authorize returns 404 | `ARGUS_PUBLIC_BASE` not set to the URL Claude is actually reaching |
