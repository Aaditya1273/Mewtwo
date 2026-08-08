// Package datahub integrates ARGUS with the DataHub metadata context platform.
//
// ARGUS acts as an MCP *client* to the DataHub MCP Server (streamable HTTP
// transport) so that governance decisions can be enriched with real metadata —
// ownership, lineage, tags, deprecation and data-quality signals. When DataHub
// is not configured the integration degrades gracefully: every API is nil-safe
// and the rest of the ARGUS ecosystem (MCP tools, OAuth, SigNoz telemetry)
// keeps working unchanged.
package datahub

import (
	"os"
	"time"
)

// Config holds the settings required to talk to a DataHub MCP Server.
//
//	DATAHUB_MCP_URL       e.g. https://<tenant>.acryl.io/integrations/ai/mcp
//	DATAHUB_TOKEN         personal access token or service-account token (Bearer)
//	DATAHUB_MUTATION_ENABLED  "true" to enable write-back tools (add_tags)
//	DATAHUB_HTTP_TIMEOUT  optional client timeout (default 15s)
type Config struct {
	MCPURL          string
	Token           string
	MutationEnabled bool
	Timeout         time.Duration
}

// ConfigFromEnv builds a Config from ARGUS_/DATAHUB_ environment variables.
func ConfigFromEnv() Config {
	timeout := 15 * time.Second
	if v := os.Getenv("DATAHUB_HTTP_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			timeout = d
		}
	}

	return Config{
		MCPURL:          os.Getenv("DATAHUB_MCP_URL"),
		Token:           os.Getenv("DATAHUB_TOKEN"),
		MutationEnabled: os.Getenv("DATAHUB_MUTATION_ENABLED") == "true",
		Timeout:         timeout,
	}
}

// Enabled reports whether the integration is configured and usable.
func (c Config) Enabled() bool {
	return c.MCPURL != "" && c.Token != ""
}
