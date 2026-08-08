#!/usr/bin/env python3
"""Seed DataHub metadata so ARGUS metadata-aware governance is demonstrable.

Uses ONLY real DataHub MCP mutation tools with their exact arg schemas
(verified against src/mcp_server_datahub/tools/ in the mcp-server-datahub
repo): add_tags(tag_urns, entity_urns, column_paths), add_owners(owner_urns,
entity_urns, ownership_type), set_domains(domain_urn, entity_urns). The server
must run with TOOLS_IS_MUTATION_ENABLED=true.

Usage:
    python examples/datahub/seed_metadata.py \
        --endpoint https://<tenant>.acryl.io/integrations/ai/mcp \
        --token <datahub pat>
"""

import argparse
import json
import sys
import urllib.request


def rpc_call(endpoint: str, token: str, method: str, params: dict) -> dict:
    """Minimal JSON-RPC 2.0 tools/call against a streamable-HTTP MCP server."""
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": method,
            "method": "tools/call",
            "params": {"name": method, "arguments": params},
        }
    ).encode()
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  !! {method} failed: HTTP {e.code} {e.read().decode()[:200]}")
        return {}
    # Streamable HTTP may return an SSE stream; take the first data line.
    if isinstance(payload, str):
        payload = json.loads(payload.split("\n")[0].removeprefix("data: "))
    return payload.get("result", payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True, help="DataHub MCP server URL")
    parser.add_argument("--token", required=True, help="DataHub PAT")
    args = parser.parse_args()

    orders_urn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,sample_orders,PROD)"
    legacy_urn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,legacy_customers,PROD)"

    # NOTE: the real add_tags tool VALIDATES tag URNs — they must already exist
    # in DataHub (tags are created via ingestion or the DataHub UI, not MCP).
    # On a fresh instance, create urn:li:tag:PII and urn:li:tag:Deprecated in
    # the UI first, or the server will reject these calls with a ValueError and
    # the demo loses its PII/Deprecated signal.
    print("== Seeding DataHub metadata for ARGUS governance demo ==")

    # 1. Tag sample_orders with PII -> ARGUS Lineage-PII plugin should block.
    #    Real add_tags args: tag_urns (list), entity_urns (list).
    print("* tagging sample_orders with PII")
    rpc_call(args.endpoint, args.token, "add_tags", {
        "tag_urns": ["urn:li:tag:PII"],
        "entity_urns": [orders_urn],
    })

    # 2. Tag legacy_customers as Deprecated -> ARGUS Deprecation plugin blocks
    #    on both the deprecation aspect AND a "Deprecated" tag (teams commonly
    #    mark retired tables this way; there is no MCP set_lifecycle_stage tool).
    print("* tagging legacy_customers as Deprecated")
    rpc_call(args.endpoint, args.token, "add_tags", {
        "tag_urns": ["urn:li:tag:Deprecated"],
        "entity_urns": [legacy_urn],
    })

    # 3. Set an owner so the Ownership plugin has something to check.
    #    Real add_owners args: owner_urns, entity_urns, ownership_type.
    print("* assigning technical owner to sample_orders")
    rpc_call(args.endpoint, args.token, "add_owners", {
        "owner_urns": ["urn:li:corpuser:data_platform_team"],
        "entity_urns": [orders_urn],
        "ownership_type": "TECHNICAL_OWNER",
    })

    # 4. Assign a domain to legacy_customers (optional, shows domain context).
    print("* assigning finance domain to legacy_customers")
    rpc_call(args.endpoint, args.token, "set_domains", {
        "domain_urn": "urn:li:domain:finance",
        "entity_urns": [legacy_urn],
    })

    print("== Done. Restart ARGUS and try:", file=sys.stderr)
    print("    curl -s 'http://localhost:8080/api/v1/argus/datahub/search?q=orders'", file=sys.stderr)
    print("  Then ask an agent to access sample_orders via datahub_access_dataset "
          "and watch it get BLOCKED.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
