package datahub

import "time"

// Asset is a lightweight, defensively-parsed view of a DataHub entity.
// Field detection is best-effort: the DataHub MCP server returns JSON text
// inside MCP content blocks, and the shapes evolve between versions, so all
// parsers degrade to empty values instead of erroring.
type Asset struct {
	URN         string   `json:"urn"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	GlossaryTerms []string `json:"glossary_terms"`
	Owners      []string `json:"owners"`
	Deprecated  bool     `json:"deprecated"`
	// QualityScore is a 0..1 signal when DataHub exposes data-quality metrics.
	QualityScore *float64 `json:"quality_score,omitempty"`
	Platform     string   `json:"platform,omitempty"`
}

// LineageNode is one hop in a lineage graph.
type LineageNode struct {
	URN        string   `json:"urn"`
	Type       string   `json:"type"`
	Name       string   `json:"name"`
	Tags       []string `json:"tags"`
	Platform   string   `json:"platform"`
	Upstream   []*LineageNode `json:"upstream,omitempty"`
	Downstream []*LineageNode `json:"downstream,omitempty"`
}

// LineageGraph is the result of a get_lineage tool call for one entity.
type LineageGraph struct {
	RootURN    string        `json:"root_urn"`
	Direction  string        `json:"direction"` // "UPSTREAM" | "DOWNSTREAM" | "BOTH"
	Upstream   []*LineageNode `json:"upstream"`
	Downstream []*LineageNode `json:"downstream"`
}

// SchemaField is one column of a dataset schema.
type SchemaField struct {
	FieldPath string   `json:"fieldPath"`
	Type      string   `json:"type"`
	Tags      []string `json:"tags"`
	Description string `json:"description"`
}

// GovernanceEvent is the audit record ARGUS writes back to DataHub (and keeps
// in-memory for the dashboard) whenever a metadata-aware rule fires.
type GovernanceEvent struct {
	Timestamp  time.Time `json:"timestamp"`
	AgentID    string    `json:"agent_id"`
	SessionID  string    `json:"session_id"`
	ToolCall   string    `json:"tool_call"`
	DatasetURN string    `json:"dataset_urn"`
	Decision   string    `json:"decision"` // ALLOW | WARN | BLOCK
	Reason     string    `json:"reason"`
	Plugin     string    `json:"plugin"`
	Severity   string    `json:"severity"`
	Action     string    `json:"action"`
}
