package mcp

// DefaultTools returns the built-in MCP tools that Claude can call through ARGUS.
// Each tool has a cost weight used by the ARGUS cost firewall to track spend.
func DefaultTools() []Tool {
	return []Tool{
		{
			Name:        "read_file",
			Description: "Read the contents of a file at the given path. Use this when you need to inspect source code, configuration files, or documentation.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Absolute or relative path to the file to read",
					},
				},
				Required: []string{"path"},
			},
		},
		{
			Name:        "search_code",
			Description: "Search the codebase for a pattern using ripgrep. Supports regex patterns, file globs, and case-insensitive search.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"pattern": map[string]any{
						"type":        "string",
						"description": "Search pattern (regex supported)",
					},
					"glob": map[string]any{
						"type":        "string",
						"description": "Optional file glob filter, e.g. '*.go' or '*.ts'",
					},
					"case_sensitive": map[string]any{
						"type":        "boolean",
						"description": "Whether the search is case sensitive (default: false)",
					},
				},
				Required: []string{"pattern"},
			},
		},
		{
			Name:        "list_directory",
			Description: "List files and directories in a given path. Returns file names, sizes, and modification times.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to the directory to list",
					},
				},
				Required: []string{"path"},
			},
		},
		{
			Name:        "analyze_codebase",
			Description: "Perform a high-level analysis of the codebase structure. Returns project language breakdown, directory tree, and key metrics.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"root_dir": map[string]any{
						"type":        "string",
						"description": "Root directory to analyze (default: current project)",
					},
					"depth": map[string]any{
						"type":        "number",
						"description": "Directory tree depth (default: 3, max: 6)",
					},
				},
			},
		},
		{
			Name:        "run_command",
			Description: "Execute a shell command and return its output. Use for building, testing, and running scripts.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"command": map[string]any{
						"type":        "string",
						"description": "Shell command to execute",
					},
					"timeout_seconds": map[string]any{
						"type":        "number",
						"description": "Timeout in seconds (default: 30, max: 120)",
					},
				},
				Required: []string{"command"},
			},
		},
		{
			Name:        "signoz_query_traces",
			Description: "Query SigNoz trace data for a given trace ID or search traces by service name and time range.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"trace_id": map[string]any{
						"type":        "string",
						"description": "Trace ID to look up",
					},
					"service_name": map[string]any{
						"type":        "string",
						"description": "Service name to filter by",
					},
					"time_range_hours": map[string]any{
						"type":        "number",
						"description": "Time range in hours to search back (default: 1)",
					},
				},
			},
		},
		{
			Name:        "signoz_get_services",
			Description: "List all services monitored by SigNoz along with their key metrics (error rate, latency, request count).",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{},
			},
		},
		{
			Name:        "signoz_list_alerts",
			Description: "List all active alert rules in SigNoz with their current status, severity, and configuration.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{},
			},
		},
		{
			Name:        "signoz_create_dashboard",
			Description: "Create a new SigNoz dashboard from a template. Supports governance, cost, and agent-DNA dashboard types.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"dashboard_type": map[string]any{
						"type":        "string",
						"description": "Dashboard type: 'governance', 'cost', or 'dna'",
						"enum":        []string{"governance", "cost", "dna"},
					},
					"title": map[string]any{
						"type":        "string",
						"description": "Optional custom title for the dashboard",
					},
				},
				Required: []string{"dashboard_type"},
			},
		},
		{
			Name:        "argus_list_agents",
			Description: "List all AI agents currently being tracked by ARGUS with their status, cost, and metrics.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{},
			},
		},
		{
			Name:        "argus_agent_dna",
			Description: "Get the behavioral DNA fingerprint and anomaly report for a specific agent trace.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"trace_id": map[string]any{
						"type":        "string",
						"description": "Trace ID to analyze",
					},
					"agent_id": map[string]any{
						"type":        "string",
						"description": "Optional agent ID for baseline context",
					},
				},
				Required: []string{"trace_id"},
			},
		},
		{
			Name:        "argus_cost_status",
			Description: "Get the current ARGUS cost firewall status, budget usage, and policy enforcement state.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{},
			},
		},
		{
			Name:        "datahub_search",
			Description: "Search the DataHub metadata catalog for datasets, dashboards, ML models and other data assets using structured keyword syntax (e.g. 'revenue_*', 'tag:PII'). Returns matching entities with their URNs and tags.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "Search query using DataHub /q syntax with boolean logic and filters",
					},
				},
				Required: []string{"query"},
			},
		},
		{
			Name:        "datahub_get_asset",
			Description: "Fetch detailed DataHub metadata for a single asset by URN — ownership, tags, glossary terms, description, deprecation status and quality signals.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub entity URN, e.g. urn:li:dataset:(urn:li:dataPlatform:snowflake,mydb.public.adoptions,PROD)",
					},
				},
				Required: []string{"urn"},
			},
		},
		{
			Name:        "datahub_get_lineage",
			Description: "Traverse the DataHub lineage graph for an asset, upstream or downstream, to understand data provenance, PII sources and impact surface.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub entity URN",
					},
					"direction": map[string]any{
						"type":        "string",
						"description": "Lineage direction: UPSTREAM, DOWNSTREAM or BOTH (default UPSTREAM)",
						"enum":        []string{"UPSTREAM", "DOWNSTREAM", "BOTH"},
					},
				},
				Required: []string{"urn"},
			},
		},
		{
			Name:        "datahub_list_schema_fields",
			Description: "List the schema fields (columns) of a DataHub dataset with their types, descriptions and tags.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub dataset URN",
					},
				},
				Required: []string{"urn"},
			},
		},
		{
			Name:        "datahub_access_dataset",
			Description: "GOVERNED dataset access: evaluates the requested dataset against ARGUS metadata-aware governance (ownership, lineage PII, compliance policies, quality, deprecation) and returns the asset metadata + schema ONLY if the access is allowed. Every decision is written back to DataHub as an audit trail.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub dataset URN to access",
					},
					"reason": map[string]any{
						"type":        "string",
						"description": "Optional business justification for the access request (recorded in the audit trail)",
					},
				},
				Required: []string{"urn"},
			},
		},
		{
			Name:        "datahub_get_dataset_queries",
			Description: "Fetch real SQL queries that reference a dataset or column — manual or system-generated — to understand usage patterns, joins, filters, and aggregation behavior before generating new SQL.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub dataset URN",
					},
					"column": map[string]any{
						"type":        "string",
						"description": "Optional column name to filter queries by",
					},
					"source": map[string]any{
						"type":        "string",
						"description": "Query origin: MANUAL or SYSTEM (default: both)",
					},
					"count": map[string]any{
						"type":        "number",
						"description": "Number of queries to return (default 10)",
					},
				},
				Required: []string{"urn"},
			},
		},
		{
			Name:        "datahub_lineage_paths_between",
			Description: "Trace the exact transformation chains between two DataHub entities or columns, including intermediate queries and columns — for impact analysis of schema changes.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"source_urn": map[string]any{
						"type":        "string",
						"description": "Source dataset URN",
					},
					"target_urn": map[string]any{
						"type":        "string",
						"description": "Target dataset URN",
					},
					"source_column": map[string]any{
						"type":        "string",
						"description": "Optional source column for column-level lineage",
					},
					"target_column": map[string]any{
						"type":        "string",
						"description": "Optional target column (required with source_column)",
					},
					"direction": map[string]any{
						"type":        "string",
						"description": "Optional: upstream or downstream (auto-discovered if omitted)",
					},
				},
				Required: []string{"source_urn", "target_urn"},
			},
		},
		{
			Name:        "datahub_get_dataset_assertions",
			Description: "List data quality assertions for a dataset with their latest run results (pass/fail) — check whether a dataset's quality gates are currently passing before trusting it.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub dataset URN",
					},
					"count": map[string]any{
						"type":        "number",
						"description": "Number of assertions to return (default 5, max 20)",
					},
				},
				Required: []string{"urn"},
			},
		},
		{
			Name:        "datahub_get_me",
			Description: "Get information about the currently authenticated DataHub user (profile, groups, privileges).",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{},
			},
		},
		{
			Name:        "datahub_remove_tag",
			Description: "Remove a tag from a DataHub entity using the remove_tags mutation tool.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub entity URN",
					},
					"tag": map[string]any{
						"type":        "string",
						"description": "Tag name or URN to remove (e.g. PII or urn:li:tag:PII)",
					},
				},
				Required: []string{"urn", "tag"},
			},
		},
		{
			Name:        "datahub_set_domain",
			Description: "Assign a business domain to a DataHub entity using the set_domains mutation tool.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"domain_urn": map[string]any{
						"type":        "string",
						"description": "Domain URN, e.g. urn:li:domain:marketing",
					},
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub entity URN",
					},
				},
				Required: []string{"domain_urn", "urn"},
			},
		},
		{
			Name:        "datahub_update_description",
			Description: "Append an ARGUS governance audit note to a dataset's description in DataHub (update_description mutation) — a write-back that always succeeds without pre-existing tags.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]any{
					"urn": map[string]any{
						"type":        "string",
						"description": "DataHub entity URN",
					},
					"note": map[string]any{
						"type":        "string",
						"description": "Audit note to append to the description",
					},
				},
				Required: []string{"urn", "note"},
			},
		},
	}
}

// ToolCost returns the cost weight for a tool (in fractional tokens/cents).
// Used by the cost firewall to track and limit agent spend.
func ToolCost(toolName string) float64 {
	costs := map[string]float64{
		"read_file":            0.001,
		"search_code":          0.002,
		"list_directory":       0.001,
		"analyze_codebase":     0.005,
		"run_command":          0.003,
		"signoz_query_traces":  0.002,
		"signoz_get_services":  0.001,
		"signoz_list_alerts":   0.001,
		"signoz_create_dashboard": 0.005,
		"argus_list_agents":    0.001,
		"argus_agent_dna":      0.002,
		"argus_cost_status":    0.001,
		"datahub_search":                0.002,
		"datahub_get_asset":             0.002,
		"datahub_get_lineage":           0.003,
		"datahub_list_schema_fields":    0.002,
		"datahub_access_dataset":        0.005,
		"datahub_get_dataset_queries":   0.003,
		"datahub_lineage_paths_between": 0.003,
		"datahub_get_dataset_assertions": 0.003,
		"datahub_get_me":                0.001,
		"datahub_remove_tag":            0.002,
		"datahub_set_domain":            0.002,
		"datahub_update_description":    0.002,
	}
	if cost, ok := costs[toolName]; ok {
		return cost
	}
	return 0.002 // default cost for unknown tools
}
