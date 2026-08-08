package datahub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SigNoz/signoz/pkg/query-service/argus/engine"
)

// server with configurable responses per test
func pluginClient(t *testing.T, assetText, lineageText string) *Client {
	t.Helper()
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
			text := ""
			switch params.Name {
			case "get_entities":
				text = assetText
			case "get_lineage":
				text = lineageText
			}
			result, _ := json.Marshal(map[string]any{
				"content": []map[string]any{{"type": "text", "text": text}},
			})
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
		default:
			http.Error(w, "unknown", http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return NewClient(Config{MCPURL: srv.URL, Token: "t", MutationEnabled: true})
}

func baseAgentCtx(urn string) *engine.AgentContext {
	return &engine.AgentContext{
		TraceID:    "trace-1",
		AgentID:    "claude-web-session-1",
		ToolName:   "datahub_access_dataset",
		DatasetURN: urn,
	}
}

func TestOwnershipPluginBlocksNonOwner(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x","globalTags":{"tags":[]},"ownership":{"owners":[{"owner":{"urn":"urn:li:corpuser:data-team"}}]}}`
	c := pluginClient(t, assetText, "")
	p := NewOwnershipPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil {
		t.Fatal("expected violation for non-owner agent")
	}
	if res.AutomaticAction != engine.ActionKillRun {
		t.Errorf("expected KILL_RUN, got %v", res.AutomaticAction)
	}
}

func TestOwnershipPluginAllowsOwner(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x","ownership":{"owners":[{"owner":{"urn":"urn:li:corpuser:claude-web-session-1"}}]}}`
	c := pluginClient(t, assetText, "")
	p := NewOwnershipPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res != nil {
		t.Fatalf("expected no violation for owner, got %v", res)
	}
}

func TestOwnershipPluginWarnsWhenNoOwners(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x"}`
	c := pluginClient(t, assetText, "")
	p := NewOwnershipPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil {
		t.Fatal("expected warn for unowned dataset")
	}
	if res.AutomaticAction != engine.ActionAlert {
		t.Errorf("expected ALERT for warn, got %v", res.AutomaticAction)
	}
}

func TestLineagePIIPluginBlocksPIIUpstream(t *testing.T) {
	// real shape: lineage returns upstreams.searchResults[].entity with
	// globalTags.tags[].tag.properties.name = PII
	lineageText := `{"upstreams":{"searchResults":[{"entity":{"urn":"urn:li:dataset:raw_events","type":"DATASET","properties":{"name":"raw_events"},"globalTags":{"tags":[{"tag":{"properties":{"name":"PII"}}}]}}}]}}`
	c := pluginClient(t, `{"urn":"urn:li:dataset:x"}`, lineageText)
	p := NewLineagePIIPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil {
		t.Fatal("expected PII violation")
	}
	if res.AutomaticAction != engine.ActionKillRun {
		t.Errorf("expected KILL_RUN, got %v", res.AutomaticAction)
	}
}

func TestLineagePIIPluginAllowsCleanLineage(t *testing.T) {
	lineageText := `{"upstreams":{"searchResults":[{"entity":{"urn":"urn:li:dataset:raw_events","type":"DATASET","properties":{"name":"raw_events"},"globalTags":{"tags":[{"tag":{"properties":{"name":"CLEAN"}}}]}}}]}}`
	c := pluginClient(t, `{"urn":"urn:li:dataset:x"}`, lineageText)
	p := NewLineagePIIPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res != nil {
		t.Fatalf("expected no violation, got %v", res)
	}
}

func TestPolicyPluginWarnsOnGDPR(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x","globalTags":{"tags":[{"tag":{"properties":{"name":"GDPR"}}}]}}`
	c := pluginClient(t, assetText, "")
	p := NewPolicyPlugin(c, false)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil {
		t.Fatal("expected GDPR violation")
	}
	if res.AutomaticAction != engine.ActionAlert {
		t.Errorf("expected ALERT for warn-mode policy, got %v", res.AutomaticAction)
	}
}

func TestPolicyPluginBlocksOnGDPRWhenFailClosed(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x","globalTags":{"tags":[{"tag":{"properties":{"name":"GDPR"}}}]}}`
	c := pluginClient(t, assetText, "")
	p := NewPolicyPlugin(c, true)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil || res.AutomaticAction != engine.ActionKillRun {
		t.Fatalf("expected KILL_RUN in fail-closed mode, got %v", res)
	}
}

func TestQualityPluginWarnsOnLowScore(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x","dataQuality":{"score":0.3}}`
	c := pluginClient(t, assetText, "")
	p := NewQualityPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil {
		t.Fatal("expected quality violation")
	}
	if res.AutomaticAction != engine.ActionAlert {
		t.Errorf("expected ALERT, got %v", res.AutomaticAction)
	}
}

func TestQualityPluginSkipsWhenNoSignal(t *testing.T) {
	c := pluginClient(t, `{"urn":"urn:li:dataset:x"}`, "")
	p := NewQualityPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res != nil {
		t.Fatalf("expected no violation when no quality signal, got %v", res)
	}
}

func TestDeprecationPluginBlocksDeprecated(t *testing.T) {
	assetText := `{"urn":"urn:li:dataset:x","deprecation":{"deprecated":true}}`
	c := pluginClient(t, assetText, "")
	p := NewDeprecationPlugin(c)

	res := p.EvaluateWithContext(context.Background(), baseAgentCtx("urn:li:dataset:x"))
	if res == nil {
		t.Fatal("expected deprecation violation")
	}
	if res.AutomaticAction != engine.ActionKillRun {
		t.Errorf("expected KILL_RUN, got %v", res.AutomaticAction)
	}
}

func TestPluginsNoOpWithoutClient(t *testing.T) {
	// nil client => plugins return nil => existing ecosystem unaffected
	ctx := baseAgentCtx("urn:li:dataset:x")
	if res := NewOwnershipPlugin(nil).EvaluateWithContext(context.Background(), ctx); res != nil {
		t.Errorf("expected nil with no client, got %v", res)
	}
	if res := NewLineagePIIPlugin(nil).EvaluateWithContext(context.Background(), ctx); res != nil {
		t.Errorf("expected nil with no client, got %v", res)
	}
	if res := NewDeprecationPlugin(nil).EvaluateWithContext(context.Background(), ctx); res != nil {
		t.Errorf("expected nil with no client, got %v", res)
	}
}

func TestPluginsNoOpWithoutDatasetURN(t *testing.T) {
	c := pluginClient(t, `{"urn":"urn:li:dataset:x"}`, "")
	ctx := &engine.AgentContext{TraceID: "t", AgentID: "a", ToolName: "read_file"}
	if res := NewLineagePIIPlugin(c).EvaluateWithContext(context.Background(), ctx); res != nil {
		t.Errorf("expected nil when no dataset URN, got %v", res)
	}
}
