# ARGUS × DataHub — Metadata-Aware Governance

ARGUS acts as an **MCP client** to the DataHub MCP Server so that every AI agent
tool call is checked against the DataHub context graph **before it executes**:

1. The agent (Claude, Cursor, any MCP client) calls `datahub_access_dataset`
   (or any governed tool) through ARGUS.
2. ARGUS evaluates the target dataset against **5 metadata-aware plugins** —
   ownership, lineage-PII, GDPR/HIPAA policy, data quality, and deprecation.
3. Blocking violations fail the tool call before the agent sees any data;
   warnings pass through but are logged; decisions are **written back to
   DataHub** as audit events (`add_tags` → `ARGUS_BLOCK` / `ARGUS_WARN` /
   `ARGUS_ALLOW`).
4. Everything is metered, traced to SigNoz, and streamed to the ARGUS dashboard
   (**DataHub Context** page).

## Prerequisites

- A DataHub instance (Acryl Cloud or OSS) with the MCP Server enabled.
  For Acryl Cloud the MCP endpoint is `https://<tenant>.acryl.io/integrations/ai/mcp`.
- A DataHub personal access token with read + mutation rights.
- The ARGUS backend running (`cmd/argus-server`).

## 1. Configure the backend

```bash
export DATAHUB_MCP_URL="https://<tenant>.acryl.io/integrations/ai/mcp"
export DATAHUB_TOKEN="<datahub pat>"
export DATAHUB_MUTATION_ENABLED="true"   # enables audit write-back
```

For self-hosted DataHub the endpoint is `http://<gms-host>:8080/mcp`.

**Server-side prerequisites** (set on the DataHub MCP server process, not
ARGUS):

```bash
TOOLS_IS_MUTATION_ENABLED=true     # enables add_tags/remove_tags/add_owners/...
# TOOLS_IS_USER_ENABLED=true       # enables get_me
# DATA_QUALITY_TOOLS_ENABLED=true  # enables get_dataset_assertions
```

That's it. When these are set, ARGUS logs
`argus: DataHub metadata-aware governance enabled` at startup. When they're
absent, everything else keeps working exactly as before (the integration is a
no-op).

> **Self-hosting?** All of these are plain env vars — the dashboard itself is
> now backend-agnostic via `ARGUS_BACKEND_URL` /
> `NEXT_PUBLIC_ARGUS_BACKEND_URL` (defaults to the hosted Render backend). See
> [`SELF_HOSTING.md`](../../SELF_HOSTING.md) for the full stack incl. Docker
> Compose and a self-hosted DataHub (`http://<gms-host>:8080/mcp`).

## 2. Verify the integration

```bash
curl -s http://localhost:8080/api/v1/argus/datahub/status | jq
```

```json
{
  "configured": true,
  "status": "active",
  "endpoint": "https://<tenant>.acryl.io/integrations/ai/mcp",
  "mutation_enabled": true,
  "plugins": ["DataHub Ownership", "Lineage-Aware PII Detection", "..."]
}
```

Search the catalog through ARGUS:

```bash
curl -s "http://localhost:8080/api/v1/argus/datahub/search?q=customer" | jq
```

## 3. Connect an agent

Point any MCP client at ARGUS (see the repo root README for the full config).
ARGUS exposes **12 DataHub-aware MCP tools**, each backed by a real DataHub
MCP tool with its exact name and argument schema (verified against the
mcp-server-datahub source):

| ARGUS tool | Backed by DataHub tool | Purpose |
|------------|------------------------|---------|
| `datahub_search` | `search` | Catalog search (`/q` syntax, filters, pagination) |
| `datahub_get_asset` | `get_entities` | Full metadata: ownership, tags, terms, deprecation, quality |
| `datahub_get_lineage` | `get_lineage` | Upstream/downstream lineage, hop control |
| `datahub_list_schema_fields` | `list_schema_fields` | Columns with keyword filter + pagination |
| `datahub_access_dataset` | (governed) | **Governed access** — 5 metadata plugins, then metadata + schema |
| `datahub_get_dataset_queries` | `get_dataset_queries` | Real SQL referencing the dataset/column |
| `datahub_lineage_paths_between` | `get_lineage_paths_between` | Exact transformation chains between two assets |
| `datahub_get_dataset_assertions` | `get_dataset_assertions` | Data-quality assertion results |
| `datahub_get_me` | `get_me` | Authenticated DataHub user |
| `datahub_remove_tag` | `remove_tags` | Remove a tag |
| `datahub_set_domain` | `set_domains` | Assign a business domain |
| `datahub_update_description` | `update_description` | Append audit notes to descriptions |

## 4. Seed demo metadata

To try it end-to-end against a fresh DataHub instance, run the seed script to
tag datasets with PII / Deprecated markers and set ownership. It uses only the
real mutation tool arg schemas (`tag_urns` + `entity_urns`, `add_owners` with
`ownership_type`):

```bash
python examples/datahub/seed_metadata.py --endpoint "$DATAHUB_MCP_URL" --token "$DATAHUB_TOKEN"
```

The script tags `sample_orders` with `PII`, tags `legacy_customers` as
`Deprecated`, assigns a technical owner, and sets a domain — then ARGUS will
block agent access to both datasets and log the decisions.
