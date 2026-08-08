package engine_test

import (
	"context"
	"log/slog"
	"testing"

	"github.com/SigNoz/signoz/pkg/query-service/argus/engine"
)

// ctxAwarePlugin implements the optional ContextAwareDetector interface.
type ctxAwarePlugin struct{}

func (p *ctxAwarePlugin) Name() string { return "Context Aware" }

func (p *ctxAwarePlugin) Evaluate(agentCtx *engine.AgentContext) *engine.RuleResult {
	return nil // must NOT be used when context-aware path exists
}

func (p *ctxAwarePlugin) EvaluateWithContext(ctx context.Context, agentCtx *engine.AgentContext) *engine.RuleResult {
	if agentCtx.DatasetURN != "" {
		return &engine.RuleResult{
			RuleName:        p.Name(),
			Severity:        engine.SeverityCritical,
			Reason:          "dataset flagged: " + agentCtx.DatasetURN,
			AutomaticAction: engine.ActionKillRun,
		}
	}
	return nil
}

func TestEnginePrefersContextAwareInterface(t *testing.T) {
	eng := engine.NewGovernanceEngine(slog.New(slog.DiscardHandler), nil)
	eng.RegisterPlugin(&ctxAwarePlugin{})

	violations := eng.EvaluateContext(context.Background(), &engine.AgentContext{
		TraceID:    "trace-1",
		DatasetURN: "urn:li:dataset:x",
	})
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation from context-aware plugin, got %d", len(violations))
	}
	if violations[0].RuleName != "Context Aware" {
		t.Errorf("unexpected rule name: %s", violations[0].RuleName)
	}
	if violations[0].AutomaticAction != engine.ActionKillRun {
		t.Errorf("expected KILL_RUN, got %v", violations[0].AutomaticAction)
	}
}

func TestEngineFallsBackToPlainInterface(t *testing.T) {
	eng := engine.NewGovernanceEngine(slog.New(slog.DiscardHandler), nil)
	eng.RegisterPlugin(&plainPlugin{})

	violations := eng.EvaluateContext(context.Background(), &engine.AgentContext{TraceID: "t"})
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation from plain plugin, got %d", len(violations))
	}
}

type plainPlugin struct{}

func (p *plainPlugin) Name() string { return "Plain" }

func (p *plainPlugin) Evaluate(agentCtx *engine.AgentContext) *engine.RuleResult {
	return &engine.RuleResult{RuleName: p.Name(), Severity: engine.SeverityLow, AutomaticAction: engine.ActionAlert}
}
