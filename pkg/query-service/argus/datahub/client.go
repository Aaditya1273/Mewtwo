package datahub

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// MCP protocol version spoken by the DataHub MCP server.
const mcpProtocolVersion = "2025-06-18"

// --- JSON-RPC 2.0 wire types (client side) ---

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// initializeParams is the MCP initialize handshake body.
type initializeParams struct {
	ProtocolVersion string             `json:"protocolVersion"`
	Capabilities    map[string]any     `json:"capabilities"`
	ClientInfo      clientInfo         `json:"clientInfo"`
}

type clientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// toolCallParams is the body of a tools/call request.
type toolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

// callToolResult mirrors the MCP CallToolResult server payload.
type callToolResult struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text,omitempty"`
	} `json:"content"`
	IsError bool `json:"isError,omitempty"`
}

// Client talks to a DataHub MCP Server over the streamable HTTP transport.
// All methods are nil-safe: a nil *Client (integration disabled) returns
// ErrNotConfigured so callers can degrade gracefully.
type Client struct {
	cfg       Config
	http      *http.Client
	baseURL   string
	sessionID string

	mu          sync.Mutex
	initialized bool
	nextID      int64
}

// NewClient returns a client for the given config, or nil when DataHub is not
// configured (so callers can keep nil-typed clients in their structs).
func NewClient(cfg Config) *Client {
	if !cfg.Enabled() {
		return nil
	}
	return &Client{
		cfg: cfg,
		http: &http.Client{Timeout: cfg.Timeout},
		baseURL: strings.TrimRight(cfg.MCPURL, "/"),
	}
}

// Configured reports whether the client is usable.
func (c *Client) Configured() bool { return c != nil }

// Config exposes the client configuration for status endpoints.
func (c *Client) Config() Config {
	if c == nil {
		return Config{}
	}
	return c.cfg
}

// ErrNotConfigured is returned when DataHub is disabled but a call was attempted.
var ErrNotConfigured = fmt.Errorf("datahub: not configured (set DATAHUB_MCP_URL and DATAHUB_TOKEN)")

// ensureInitialized performs the MCP initialize handshake once and captures the
// server session id if the server sends one.
func (c *Client) ensureInitialized(ctx context.Context) error {
	if c == nil {
		return ErrNotConfigured
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.initialized {
		return nil
	}

	resp, err := c.roundTrip(ctx, rpcRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
		Params: initializeParams{
			ProtocolVersion: mcpProtocolVersion,
			Capabilities:    map[string]any{},
			ClientInfo:      clientInfo{Name: "argus-control-plane", Version: "1.0.0"},
		},
	}, true)
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf("datahub: initialize failed: %s", resp.Error.Message)
	}

	c.initialized = true
	return nil
}

// roundTrip posts one JSON-RPC request and parses the response. The response
// may be a single application/json body or a text/event-stream (streamable
// HTTP transport); both are handled here. When captureSession is true the
// Mcp-Session-Id response header is stored for subsequent requests.
func (c *Client) roundTrip(ctx context.Context, req rpcRequest, captureSession bool) (*rpcResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+c.cfg.Token)
	if c.sessionID != "" {
		httpReq.Header.Set("Mcp-Session-Id", c.sessionID)
	}

	httpResp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("datahub: http error: %w", err)
	}
	defer httpResp.Body.Close()

	if captureSession {
		if sid := httpResp.Header.Get("Mcp-Session-Id"); sid != "" {
			c.sessionID = sid
		}
	}

	ct := httpResp.Header.Get("Content-Type")
	if strings.Contains(ct, "text/event-stream") {
		return parseSSEResponse(httpResp.Body)
	}
	if httpResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(httpResp.Body, 4096))
		return nil, fmt.Errorf("datahub: http %d: %s", httpResp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var parsed rpcResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("datahub: invalid json response: %w", err)
	}
	return &parsed, nil
}

// parseSSEResponse reads a text/event-stream body and returns the first
// "message" event's JSON payload (the streamable HTTP transport wraps each
// JSON-RPC response in an SSE message event).
func parseSSEResponse(r io.Reader) (*rpcResponse, error) {
	scanner := bufio.NewScanner(r)
	var data []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if payload != "" {
				data = append(data, payload)
			}
		} else if line == "" && len(data) > 0 {
			// event boundary — try to parse what we have
			raw := strings.Join(data, "")
			var parsed rpcResponse
			if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
				return &parsed, nil
			}
			data = nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("datahub: sse read error: %w", err)
	}
	// trailing data block
	if len(data) > 0 {
		raw := strings.Join(data, "")
		var parsed rpcResponse
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			return &parsed, nil
		}
	}
	return nil, fmt.Errorf("datahub: no JSON-RPC message found in SSE stream")
}

// callTool invokes a named MCP tool and returns its concatenated text content.
func (c *Client) callTool(ctx context.Context, name string, args map[string]any) (string, bool, error) {
	if c == nil {
		return "", false, ErrNotConfigured
	}
	if err := c.ensureInitialized(ctx); err != nil {
		return "", false, err
	}

	c.mu.Lock()
	c.nextID++
	id := c.nextID
	c.mu.Unlock()

	resp, err := c.roundTrip(ctx, rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  "tools/call",
		Params:  toolCallParams{Name: name, Arguments: args},
	}, false)
	if err != nil {
		return "", false, err
	}
	if resp.Error != nil {
		return "", false, fmt.Errorf("datahub: tool %s failed: %s", name, resp.Error.Message)
	}

	var result callToolResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return "", false, fmt.Errorf("datahub: cannot decode tool result for %s: %w", name, err)
	}

	var sb strings.Builder
	for _, item := range result.Content {
		if item.Type == "text" {
			sb.WriteString(item.Text)
			sb.WriteString("\n")
		}
	}
	return sb.String(), result.IsError, nil
}

// --- High-level DataHub operations (real MCP tool names + arg schemas) ---
//
// Every method below calls the DataHub MCP server with the EXACT tool names and
// argument names from the mcp-server-datahub source (verified against
// src/mcp_server_datahub/tools/). The real `get_lineage` takes `urn` +
// `upstream` (bool) + `max_hops` + `max_results`; the real `add_tags` takes
// `tag_urns` + `entity_urns` (+ optional `column_paths`).

// Search runs the DataHub `search` tool and returns matching entities.
// query uses the server's /q structured syntax (e.g. "*", "customer").
func (c *Client) Search(ctx context.Context, query string, numResults ...int) ([]Asset, error) {
	n := 10
	if len(numResults) > 0 && numResults[0] > 0 {
		n = numResults[0]
	}
	text, _, err := c.callTool(ctx, "search", map[string]any{"query": query, "num_results": n})
	if err != nil {
		return nil, err
	}
	return ParseAssets(text), nil
}

// GetEntity runs the DataHub `get_entities` tool for a single URN.
// The real server accepts `urns` (string or array) and returns a single dict
// for a single string input.
func (c *Client) GetEntity(ctx context.Context, urn string) (*Asset, error) {
	text, isErr, err := c.callTool(ctx, "get_entities", map[string]any{"urns": urn})
	if err != nil {
		return nil, err
	}
	if isErr {
		return nil, fmt.Errorf("datahub: get_entities reported an error for %s", urn)
	}
	return ParseAsset(text, urn), nil
}

// GetLineage runs the DataHub `get_lineage` tool.
// upstream selects direction (true=upstream, false=downstream). The server
// supports column-level lineage and hop control; defaults mirror the server.
func (c *Client) GetLineage(ctx context.Context, urn string, upstream bool, maxHops ...int) (*LineageGraph, error) {
	hops := 1
	if len(maxHops) > 0 && maxHops[0] > 0 {
		hops = maxHops[0]
	}
	direction := "DOWNSTREAM"
	if upstream {
		direction = "UPSTREAM"
	}
	text, _, err := c.callTool(ctx, "get_lineage", map[string]any{
		"urn":        urn,
		"upstream":   upstream,
		"max_hops":   hops,
		"max_results": 30,
	})
	if err != nil {
		return nil, err
	}
	return ParseLineage(text, urn, direction), nil
}

// GetLineagePathsBetween runs the DataHub `get_lineage_paths_between` tool,
// which traces the exact transformation chains between two entities or columns.
// direction: "upstream", "downstream", or empty for auto-discovery.
func (c *Client) GetLineagePathsBetween(ctx context.Context, sourceURN, targetURN, sourceColumn, targetColumn, direction string) (string, error) {
	args := map[string]any{
		"source_urn": sourceURN,
		"target_urn": targetURN,
	}
	if sourceColumn != "" {
		args["source_column"] = sourceColumn
	}
	if targetColumn != "" {
		args["target_column"] = targetColumn
	}
	if direction != "" {
		args["direction"] = direction
	}
	text, _, err := c.callTool(ctx, "get_lineage_paths_between", args)
	return text, err
}

// ListSchemaFields runs the DataHub `list_schema_fields` tool with optional
// keyword filtering and pagination (limit/offset) matching the real server.
func (c *Client) ListSchemaFields(ctx context.Context, urn string, keywords []string, limit, offset int) ([]SchemaField, error) {
	if limit <= 0 {
		limit = 100
	}
	args := map[string]any{"urn": urn, "limit": limit, "offset": offset}
	if len(keywords) > 0 {
		args["keywords"] = keywords
	}
	text, _, err := c.callTool(ctx, "list_schema_fields", args)
	if err != nil {
		return nil, err
	}
	return ParseSchemaFields(text), nil
}

// GetDatasetQueries runs the DataHub `get_dataset_queries` tool and returns the
// raw text (real SQL queries referencing the dataset/column).
func (c *Client) GetDatasetQueries(ctx context.Context, urn string, column, source string, count int) (string, error) {
	if count <= 0 {
		count = 10
	}
	args := map[string]any{"urn": urn, "count": count}
	if column != "" {
		args["column"] = column
	}
	if source != "" {
		args["source"] = source // MANUAL | SYSTEM
	}
	text, _, err := c.callTool(ctx, "get_dataset_queries", args)
	return text, err
}

// GetDatasetAssertions runs the DataHub `get_dataset_assertions` tool
// (DATA_QUALITY_TOOLS_ENABLED=true on the server) and returns the raw text.
func (c *Client) GetDatasetAssertions(ctx context.Context, urn string, count int) (string, error) {
	if count <= 0 {
		count = 5
	}
	text, _, err := c.callTool(ctx, "get_dataset_assertions", map[string]any{"urn": urn, "count": count})
	return text, err
}

// GetMe runs the DataHub `get_me` tool (TOOLS_IS_USER_ENABLED=true on the
// server) and returns the raw text.
func (c *Client) GetMe(ctx context.Context) (string, error) {
	text, _, err := c.callTool(ctx, "get_me", map[string]any{})
	return text, err
}

// AddTag runs the DataHub `add_tags` mutation tool with the real argument
// schema (tag_urns + entity_urns). Requires TOOLS_IS_MUTATION_ENABLED=true on
// the server and DATAHUB_MUTATION_ENABLED=true in ARGUS. tag is a tag URN
// (e.g. "urn:li:tag:ARGUS_BLOCK") or a plain name — the server validates URNs.
func (c *Client) AddTag(ctx context.Context, urn, tag string) error {
	if c == nil {
		return ErrNotConfigured
	}
	if !c.cfg.MutationEnabled {
		return fmt.Errorf("datahub: write-back disabled (set DATAHUB_MUTATION_ENABLED=true and TOOLS_IS_MUTATION_ENABLED=true server-side)")
	}
	tagURN := tag
	if !strings.HasPrefix(tag, "urn:li:tag:") {
		tagURN = "urn:li:tag:" + tag
	}
	_, isErr, err := c.callTool(ctx, "add_tags", map[string]any{
		"tag_urns":    []string{tagURN},
		"entity_urns": []string{urn},
	})
	if err != nil {
		return err
	}
	if isErr {
		return fmt.Errorf("datahub: add_tags reported an error for %s", urn)
	}
	return nil
}

// RemoveTag runs the DataHub `remove_tags` mutation tool.
func (c *Client) RemoveTag(ctx context.Context, urn, tag string) error {
	if c == nil {
		return ErrNotConfigured
	}
	if !c.cfg.MutationEnabled {
		return fmt.Errorf("datahub: write-back disabled")
	}
	tagURN := tag
	if !strings.HasPrefix(tag, "urn:li:tag:") {
		tagURN = "urn:li:tag:" + tag
	}
	_, isErr, err := c.callTool(ctx, "remove_tags", map[string]any{
		"tag_urns":    []string{tagURN},
		"entity_urns": []string{urn},
	})
	if err != nil {
		return err
	}
	if isErr {
		return fmt.Errorf("datahub: remove_tags reported an error for %s", urn)
	}
	return nil
}

// AddOwners runs the DataHub `add_owners` mutation tool.
// ownershipType: TECHNICAL_OWNER | BUSINESS_OWNER | DATA_STEWARD or a custom name.
func (c *Client) AddOwners(ctx context.Context, ownerURNs []string, entityURNs []string, ownershipType string) error {
	if c == nil {
		return ErrNotConfigured
	}
	if !c.cfg.MutationEnabled {
		return fmt.Errorf("datahub: write-back disabled")
	}
	if ownershipType == "" {
		ownershipType = "TECHNICAL_OWNER"
	}
	_, isErr, err := c.callTool(ctx, "add_owners", map[string]any{
		"owner_urns":     ownerURNs,
		"entity_urns":    entityURNs,
		"ownership_type": ownershipType,
	})
	if err != nil {
		return err
	}
	if isErr {
		return fmt.Errorf("datahub: add_owners reported an error")
	}
	return nil
}

// SetDomains runs the DataHub `set_domains` mutation tool.
func (c *Client) SetDomains(ctx context.Context, domainURN string, entityURNs []string) error {
	if c == nil {
		return ErrNotConfigured
	}
	if !c.cfg.MutationEnabled {
		return fmt.Errorf("datahub: write-back disabled")
	}
	_, isErr, err := c.callTool(ctx, "set_domains", map[string]any{
		"domain_urn":  domainURN,
		"entity_urns": entityURNs,
	})
	if err != nil {
		return err
	}
	if isErr {
		return fmt.Errorf("datahub: set_domains reported an error")
	}
	return nil
}

// UpdateDescription runs the DataHub `update_description` mutation tool.
func (c *Client) UpdateDescription(ctx context.Context, entityURN, operation, description, columnPath string) error {
	if c == nil {
		return ErrNotConfigured
	}
	if !c.cfg.MutationEnabled {
		return fmt.Errorf("datahub: write-back disabled")
	}
	args := map[string]any{"entity_urn": entityURN, "operation": operation}
	if description != "" {
		args["description"] = description
	}
	if columnPath != "" {
		args["column_path"] = columnPath
	}
	_, isErr, err := c.callTool(ctx, "update_description", args)
	if err != nil {
		return err
	}
	if isErr {
		return fmt.Errorf("datahub: update_description reported an error")
	}
	return nil
}

// Health performs a lightweight connectivity check (a search with an empty
// query is avoided; instead we just attempt the handshake if not done).
func (c *Client) Health(ctx context.Context) error {
	return c.ensureInitialized(ctx)
}
