package mcp

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/SigNoz/signoz/pkg/query-service/argus/engine"
)

func newTestMCPServer() *MCPServer {
	return NewMCPServer(slog.New(slog.DiscardHandler), ".")
}

func callTool(t *testing.T, s *MCPServer, clientID, name string, args map[string]any) *Response {
	t.Helper()
	params, err := json.Marshal(CallToolRequest{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	req, _ := json.Marshal(Request{
		JSONRPC: JSONRPCVersion,
		ID:      json.RawMessage(`1`),
		Method:  MethodToolsCall,
		Params:  params,
	})
	return s.HandleRequest(context.Background(), req, clientID)
}

// blockingFn returns a KILL_RUN violation when a dataset URN is present.
func blockingFn(ctx context.Context, govCtx *GovernanceContext) []engine.RuleResult {
	if govCtx.DatasetURN == "" {
		return nil
	}
	return []engine.RuleResult{{
		RuleName:        "Lineage-Aware PII Detection",
		Severity:        engine.SeverityCritical,
		Reason:          "Dataset derives from a PII-tagged upstream asset.",
		AutomaticAction: engine.ActionKillRun,
	}}
}

// warnFn returns a non-blocking ALERT violation.
func warnFn(ctx context.Context, govCtx *GovernanceContext) []engine.RuleResult {
	if govCtx.DatasetURN == "" {
		return nil
	}
	return []engine.RuleResult{{
		RuleName:        "DataHub Data Quality",
		Severity:        engine.SeverityMedium,
		Reason:          "Low quality score.",
		AutomaticAction: engine.ActionAlert,
	}}
}

func TestGovernanceBlocksDatasetAccess(t *testing.T) {
	s := newTestMCPServer()
	s.SetGovernanceFn(blockingFn)

	resp := callTool(t, s, "claude-1", "datahub_access_dataset", map[string]any{
		"urn": "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)",
	})

	var out struct {
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal(resp.Result, &out.Result); err != nil {
		t.Fatalf("cannot decode response: %v", err)
	}
	if !out.Result.IsError {
		t.Fatal("expected the tool call to be blocked")
	}
	if len(out.Result.Content) == 0 || len(out.Result.Content[0].Text) == 0 {
		t.Fatal("expected a block reason in the response")
	}
	if want := "Lineage-Aware PII Detection"; !contains(out.Result.Content[0].Text, want) {
		t.Errorf("expected reason to mention %q, got %q", want, out.Result.Content[0].Text)
	}
}

func TestGovernanceAllowsWarnOnly(t *testing.T) {
	s := newTestMCPServer()
	s.SetGovernanceFn(warnFn)

	resp := callTool(t, s, "claude-1", "datahub_access_dataset", map[string]any{
		"urn": "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.public.customers,PROD)",
	})

	var out struct {
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
		Error *struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(resp.Result, &out.Result); err != nil {
		t.Fatalf("cannot decode response: %v", err)
	}
	if out.Result.IsError {
		t.Fatal("expected ALERT violation to NOT block execution")
	}
	if out.Error != nil {
		t.Fatalf("expected no JSON-RPC error, got %+v", out.Error)
	}
}

func TestGovernanceSkipsWithoutGovernanceFn(t *testing.T) {
	// No governance fn installed => tool call proceeds untouched (backwards
	// compatible with the existing ecosystem).
	s := newTestMCPServer()
	resp := callTool(t, s, "claude-1", "argus_cost_status", map[string]any{})
	if resp.Error != nil {
		t.Fatalf("expected successful call without governance, got %+v", resp.Error)
	}
}

func TestGovernanceSkipsNonDatasetCalls(t *testing.T) {
	s := newTestMCPServer()
	s.SetGovernanceFn(blockingFn)

	// argus_cost_status has no dataset context and never touches the filesystem.
	resp := callTool(t, s, "claude-1", "argus_cost_status", map[string]any{})
	var out struct {
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal(resp.Result, &out.Result); err != nil {
		t.Fatalf("cannot decode response: %v", err)
	}
	if out.Result.IsError {
		t.Fatal("expected non-dataset tool call to proceed")
	}
}

func TestDataHubToolsReportUnavailable(t *testing.T) {
	s := newTestMCPServer() // no DataHub client registered

	resp := callTool(t, s, "claude-1", "datahub_search", map[string]any{"query": "customers"})
	var out struct {
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if err := json.Unmarshal(resp.Result, &out.Result); err != nil {
		t.Fatalf("cannot decode response: %v", err)
	}
	text := ""
	if len(out.Result.Content) > 0 {
		text = out.Result.Content[0].Text
	}
	if !contains(text, "DataHub is not configured") {
		t.Errorf("expected a friendly 'not configured' message, got %q", text)
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})())
}
