package datahub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockMCPServer is a minimal DataHub MCP Server over streamable HTTP. It
// implements the JSON-RPC 2.0 handshake and tools/call with canned payloads
// mirroring the DataHub MCP server's real response shapes.
type mockMCPServer struct {
	mu         chan struct{}
	searchText string
	assetText  string
	lineageText string
	schemaText string
	initialized bool
}

func newMockMCPServer() *mockMCPServer {
	// These payloads mirror the REAL response shapes of the DataHub MCP server
	// (verified against src/mcp_server_datahub/): search returns
	// {"searchResults":[{"entity":{...}}]}, lineage returns
	// {"upstreams":{"searchResults":[{"entity":{...}}]}}, and entity names
	// live under properties.name.
	return &mockMCPServer{
		searchText: `{"searchResults":[{"entity":{"urn":"urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)","type":"DATASET","properties":{"name":"customers"},"globalTags":{"tags":[{"tag":{"properties":{"name":"PII"}}}]}}}]}`,
		assetText: `{
			"urn": "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)",
			"type": "DATASET",
			"properties": {"name": "customers", "description": "Customer master data"},
			"platform": {"name": "snowflake"},
			"deprecation": {"deprecated": false},
			"globalTags": {"tags":[{"tag":{"properties":{"name":"PII"}}}]},
			"ownership": {"owners":[{"owner":{"urn":"urn:li:corpuser:data-team"}}]}
		}`,
		lineageText: `{"upstreams":{"searchResults":[{"entity":{"urn":"urn:li:dataset:(urn:li:dataPlatform:snowflake,raw.customer_events,PROD)","type":"DATASET","properties":{"name":"customer_events"},"globalTags":{"tags":[{"tag":{"properties":{"name":"PII"}}}]}}}]}}`,
		schemaText: `{"urn":"urn:li:dataset:customers","fields":[{"fieldPath":"customer_id","type":"string","description":"customer id"},{"fieldPath":"email","type":"string","tags":["PII"]}],"totalFields":2,"returned":2}`,
	}
}

func (m *mockMCPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case "initialize":
		m.initialized = true
		w.Header().Set("Mcp-Session-Id", "sess-123")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  json.RawMessage(`{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"datahub-mcp","version":"test"}}`),
		})
	case "tools/call":
		var params toolCallParams
		if raw, err := json.Marshal(req.Params); err == nil {
			_ = json.Unmarshal(raw, &params)
		}
		var text string
		switch params.Name {
		case "search":
			text = m.searchText
		case "get_entities":
			text = m.assetText
		case "get_lineage":
			text = m.lineageText
		case "list_schema_fields":
			text = m.schemaText
		case "add_tags":
			// real add_tags returns {success, message}
			text = `{"success":true,"message":"Successfully added 1 tag(s) to 1 entit(ies)"}`
		case "update_description":
			text = `{"success":true,"message":"Description updated"}`
		default:
			text = `{"error":"unknown tool"}`
		}
		result, _ := json.Marshal(map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
		})
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	default:
		http.Error(w, "unknown method", http.StatusNotFound)
	}
}


func testClient(t *testing.T, m *mockMCPServer) *Client {
	t.Helper()
	srv := httptest.NewServer(m)
	t.Cleanup(srv.Close)
	c := NewClient(Config{
		MCPURL:          srv.URL,
		Token:           "test-token",
		MutationEnabled: true,
	})
	if c == nil {
		t.Fatal("expected non-nil client for configured env")
	}
	return c
}

func TestClientNotConfigured(t *testing.T) {
	if c := NewClient(Config{}); c != nil {
		t.Fatal("expected nil client when not configured")
	}
}

func TestSearch(t *testing.T) {
	m := newMockMCPServer()
	c := testClient(t, m)

	assets, err := c.Search(context.Background(), "customers")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("expected 1 asset, got %d", len(assets))
	}
	if assets[0].Name != "customers" {
		t.Errorf("expected name customers, got %q", assets[0].Name)
	}
	if !hasTag(assets[0].Tags, "", "PII") {
		t.Errorf("expected PII tag detected in search results, got %v", assets[0].Tags)
	}
}

func TestGetEntity(t *testing.T) {
	m := newMockMCPServer()
	c := testClient(t, m)

	asset, err := c.GetEntity(context.Background(), "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)")
	if err != nil {
		t.Fatalf("get entity failed: %v", err)
	}
	if asset == nil {
		t.Fatal("expected asset")
	}
	if asset.Name != "customers" {
		t.Errorf("expected name customers, got %q", asset.Name)
	}
	if !asset.Deprecated {
		t.Log("expected not deprecated")
	}
	if !hasTag(asset.Tags, "", "PII") {
		t.Errorf("expected PII tag, got %v", asset.Tags)
	}
	if len(asset.Owners) == 0 {
		t.Error("expected owners parsed")
	}
	if asset.Platform != "snowflake" {
		t.Errorf("expected platform snowflake, got %q", asset.Platform)
	}
}

func TestGetLineage(t *testing.T) {
	m := newMockMCPServer()
	c := testClient(t, m)

	graph, err := c.GetLineage(context.Background(), "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)", true, 2)
	if err != nil {
		t.Fatalf("get lineage failed: %v", err)
	}
	if graph == nil {
		t.Fatal("expected graph")
	}
	if len(graph.Upstream) == 0 {
		t.Fatal("expected upstream nodes")
	}
	tags := graph.FlattenLineageTags()
	if !hasTag(tags, "", "PII") {
		t.Errorf("expected PII in lineage tags, got %v", tags)
	}
}

// TestGetLineageSendsRealArgs verifies the client calls get_lineage with the
// REAL arg schema (urn + upstream bool + max_hops + max_results), not the
// invented urns/direction pair from the earlier draft.
func TestGetLineageSendsRealArgs(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		switch req.Method {
		case "initialize":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: json.RawMessage(`{"protocolVersion":"2025-06-18","serverInfo":{"name":"m"}}`)})
		case "tools/call":
			var params toolCallParams
			if raw, err := json.Marshal(req.Params); err == nil {
				_ = json.Unmarshal(raw, &params)
			}
			if params.Name == "get_lineage" {
				got = params.Arguments
			}
			result, _ := json.Marshal(map[string]any{
				"content": []map[string]any{{"type": "text", "text": `{"upstreams":{"searchResults":[]}}`}},
			})
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
		}
	}))
	t.Cleanup(srv.Close)
	c := NewClient(Config{MCPURL: srv.URL, Token: "t", MutationEnabled: true})

	_, _ = c.GetLineage(context.Background(), "urn:li:dataset:x", true, 3)
	if got == nil {
		t.Fatal("expected get_lineage call to be captured")
	}
	if _, hasURN := got["urn"]; !hasURN {
		t.Errorf("expected real arg 'urn', got %v", got)
	}
	if _, hasUpstream := got["upstream"]; !hasUpstream {
		t.Errorf("expected real arg 'upstream' (bool), got %v", got)
	}
	if _, hasHops := got["max_hops"]; !hasHops {
		t.Errorf("expected real arg 'max_hops', got %v", got)
	}
	if _, bad := got["direction"]; bad {
		t.Errorf("must NOT send invented 'direction' arg, got %v", got)
	}
}

// TestAddTagSendsRealArgs verifies add_tags uses tag_urns + entity_urns and
// tags get URN-prefixed, matching the real server's schema.
func TestAddTagSendsRealArgs(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		switch req.Method {
		case "initialize":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: json.RawMessage(`{"protocolVersion":"2025-06-18","serverInfo":{"name":"m"}}`)})
		case "tools/call":
			var params toolCallParams
			if raw, err := json.Marshal(req.Params); err == nil {
				_ = json.Unmarshal(raw, &params)
			}
			if params.Name == "add_tags" {
				got = params.Arguments
			}
			result, _ := json.Marshal(map[string]any{
				"content": []map[string]any{{"type": "text", "text": `{"success":true,"message":"ok"}`}},
			})
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
		}
	}))
	t.Cleanup(srv.Close)
	c := NewClient(Config{MCPURL: srv.URL, Token: "t", MutationEnabled: true})

	_ = c.AddTag(context.Background(), "urn:li:dataset:x", "ARGUS_BLOCK")
	if got == nil {
		t.Fatal("expected add_tags call to be captured")
	}
	if _, hasTagURNs := got["tag_urns"]; !hasTagURNs {
		t.Errorf("expected real arg 'tag_urns', got %v", got)
	}
	if _, hasEntityURNs := got["entity_urns"]; !hasEntityURNs {
		t.Errorf("expected real arg 'entity_urns', got %v", got)
	}
	if tagURNs, ok := got["tag_urns"].([]any); ok {
		if len(tagURNs) != 1 || tagURNs[0] != "urn:li:tag:ARGUS_BLOCK" {
			t.Errorf("expected tag_urns to be URN-prefixed [urn:li:tag:ARGUS_BLOCK], got %v", tagURNs)
		}
	}
	if _, bad := got["urns"]; bad {
		t.Errorf("must NOT send invented 'urns' arg, got %v", got)
	}
}

func TestListSchemaFields(t *testing.T) {
	m := newMockMCPServer()
	c := testClient(t, m)

	fields, err := c.ListSchemaFields(context.Background(), "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)", nil, 100, 0)
	if err != nil {
		t.Fatalf("list schema failed: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("expected 2 fields, got %d", len(fields))
	}
	if fields[0].FieldPath != "customer_id" {
		t.Errorf("expected customer_id, got %q", fields[0].FieldPath)
	}
	// real cleaned shape: tags come back as a plain string array on the field
	if !hasTag(fields[1].Tags, "", "PII") {
		t.Errorf("expected PII tag on email field, got %v", fields[1].Tags)
	}
}

func TestAddTag(t *testing.T) {
	m := newMockMCPServer()
	c := testClient(t, m)

	if err := c.AddTag(context.Background(), "urn:li:dataset:...", "ARGUS_BLOCK"); err != nil {
		t.Fatalf("add tag failed: %v", err)
	}
}

func TestAddTagDisabledMutation(t *testing.T) {
	m := newMockMCPServer()
	srv := httptest.NewServer(m)
	t.Cleanup(srv.Close)
	c := NewClient(Config{MCPURL: srv.URL, Token: "t", MutationEnabled: false})

	if err := c.AddTag(context.Background(), "urn:li:dataset:...", "ARGUS_BLOCK"); err == nil {
		t.Fatal("expected error when mutation disabled")
	}
}

func TestParseAssetRawTextFallback(t *testing.T) {
	// If the server returns prose instead of JSON, the parser must still
	// extract URNs and tag mentions so governance stays functional.
	text := "Here is the asset: urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.raw_events,PROD). It contains tag:PII data."
	asset := ParseAsset(text, "")
	if asset.URN == "" {
		t.Error("expected URN extracted from raw text")
	}
	if !hasTag(asset.Tags, text, "PII") {
		t.Errorf("expected PII from raw text, got %v", asset.Tags)
	}
}

func TestLineageRawTextFallback(t *testing.T) {
	text := "upstream: urn:li:dataset:(urn:li:dataPlatform:snowflake,raw.events,PROD) [tag:PII]"
	graph := ParseLineage(text, "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.x,PROD)", "UPSTREAM")
	if len(graph.Upstream) == 0 {
		t.Fatal("expected upstream node from raw text")
	}
	tags := graph.FlattenLineageTags()
	if !hasTag(tags, text, "PII") {
		t.Errorf("expected PII from raw lineage text, got %v", tags)
	}
}

func TestEventStore(t *testing.T) {
	store := NewEventStore(3)
	store.Record(GovernanceEvent{Decision: DecisionBlock, DatasetURN: "urn:li:dataset:a"})
	store.Record(GovernanceEvent{Decision: DecisionBlock, DatasetURN: "urn:li:dataset:b"})
	store.Record(GovernanceEvent{Decision: DecisionWarn, DatasetURN: "urn:li:dataset:c"})
	store.Record(GovernanceEvent{Decision: DecisionAllow, DatasetURN: "urn:li:dataset:d"})

	events := store.All()
	if len(events) != 3 {
		t.Fatalf("expected 3 retained events, got %d", len(events))
	}
	if events[0].DatasetURN != "urn:li:dataset:d" {
		t.Errorf("expected newest first, got %v", events[0].DatasetURN)
	}
}

func TestWriteBackRecordsEvent(t *testing.T) {
	m := newMockMCPServer()
	c := testClient(t, m)
	store := NewEventStore(10)

	c.WriteBack(context.Background(), store, GovernanceEvent{
		DatasetURN: "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)",
		Decision:   DecisionBlock,
		Reason:     "PII upstream",
		Plugin:     "Lineage-Aware PII Detection",
	})

	if len(store.All()) != 1 {
		t.Fatalf("expected 1 event recorded, got %d", len(store.All()))
	}
	e := store.All()[0]
	if e.Decision != DecisionBlock {
		t.Errorf("expected BLOCK decision, got %s", e.Decision)
	}
	if e.Plugin != "Lineage-Aware PII Detection" {
		t.Errorf("expected plugin recorded, got %q", e.Plugin)
	}
}

// silence unused import lint for fmt in some go versions
var _ = fmt.Sprintf
