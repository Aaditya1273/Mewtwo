package datahub

import (
	"context"
	"fmt"
	"strings"

	"github.com/SigNoz/signoz/pkg/query-service/argus/engine"
)

// Each plugin below implements engine.ContextAwareDetector so it runs on the
// governance hot path with a request context. All plugins are nil-safe: when
// the DataHub client is nil (integration disabled) or the current tool call
// does not touch a dataset (empty DatasetURN) they return nil — i.e. they have
// zero effect on the existing ARGUS ecosystem.

// Decision values recorded in the DataHub audit trail.
const (
	DecisionAllow = "ALLOW"
	DecisionWarn  = "WARN"
	DecisionBlock = "BLOCK"
)

// result builds a RuleResult with DataHub-aware messaging.
func result(plugin, decision, severity string, reason string) *engine.RuleResult {
	return &engine.RuleResult{
		RuleName:          plugin,
		Severity:          engine.Severity(severity),
		Reason:            reason,
		RecommendedAction: "Review the dataset metadata in DataHub and update ownership, tags, or lifecycle state.",
		AutomaticAction:   actionFor(decision, severity),
	}
}

// actionFor maps a governance decision to the engine's automatic action.
// BLOCK maps to KILL_RUN (fail-closed), WARN to ALERT.
func actionFor(decision, severity string) engine.AutomaticAction {
	if decision == DecisionBlock {
		return engine.ActionKillRun
	}
	return engine.ActionAlert
}

// warnOrSkip emits a WARN violation when the client is configured but a check
// cannot be completed (fail-open but visible), or nil when DataHub is disabled.
func warnOrSkip(client *Client, plugin, reason string) *engine.RuleResult {
	if client == nil {
		return nil
	}
	return result(plugin, DecisionWarn, string(engine.SeverityMedium), reason)
}

// --- Ownership ---

// OwnershipPlugin blocks tool calls that access a dataset the agent does not
// own (per DataHub ownership metadata). Unowned datasets produce a WARN so
// teams notice missing ownership instead of silently failing.
type OwnershipPlugin struct {
	client *Client
}

// NewOwnershipPlugin creates the ownership detector.
func NewOwnershipPlugin(client *Client) *OwnershipPlugin {
	return &OwnershipPlugin{client: client}
}

// Name implements engine.DetectorPlugin.
func (p *OwnershipPlugin) Name() string { return "DataHub Ownership" }

// Evaluate implements the context-free interface (falls back to a warn when
// no context is available).
func (p *OwnershipPlugin) Evaluate(ctx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(ctx, nil)
}

// EvaluateWithContext implements engine.ContextAwareDetector.
func (p *OwnershipPlugin) EvaluateWithContext(ctx context.Context, agentCtx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(agentCtx, ctx)
}

func (p *OwnershipPlugin) evaluate(agentCtx *engine.AgentContext, ctx context.Context) *engine.RuleResult {
	if p.client == nil || agentCtx == nil || agentCtx.DatasetURN == "" {
		return nil
	}

	callCtx := ctx
	if callCtx == nil {
		callCtx = context.Background()
	}

	asset, err := p.client.GetEntity(callCtx, agentCtx.DatasetURN)
	if err != nil {
		return warnOrSkip(p.client, p.Name(), fmt.Sprintf("Could not verify ownership for %s: %v", agentCtx.DatasetURN, err))
	}
	if asset == nil || len(asset.Owners) == 0 {
		return result(p.Name(), DecisionWarn, string(engine.SeverityMedium),
			fmt.Sprintf("Dataset %s has no owners in DataHub — ownership review recommended before agent access.", agentCtx.DatasetURN))
	}

	agentID := agentCtx.AgentID
	if agentID == "" {
		agentID = agentCtx.TraceID
	}
	for _, owner := range asset.Owners {
		if shortName(owner) == shortName(agentID) || strings.EqualFold(owner, agentID) {
			return nil // agent is an owner → allowed
		}
	}

	return result(p.Name(), DecisionBlock, string(engine.SeverityCritical),
		fmt.Sprintf("Agent %s is not an owner of dataset %s (owners: %v). Access blocked by ARGUS metadata policy.", agentID, agentCtx.DatasetURN, asset.Owners))
}

// --- Lineage PII ---

// LineagePIIPlugin blocks access to datasets whose upstream lineage contains
// PII / Sensitive / PHI tagged assets — the flagship metadata-aware rule.
type LineagePIIPlugin struct {
	client *Client
}

// NewLineagePIIPlugin creates the lineage detector.
func NewLineagePIIPlugin(client *Client) *LineagePIIPlugin {
	return &LineagePIIPlugin{client: client}
}

// Name implements engine.DetectorPlugin.
func (p *LineagePIIPlugin) Name() string { return "Lineage-Aware PII Detection" }

// Evaluate implements the context-free interface.
func (p *LineagePIIPlugin) Evaluate(ctx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(ctx, nil)
}

// EvaluateWithContext implements engine.ContextAwareDetector.
func (p *LineagePIIPlugin) EvaluateWithContext(ctx context.Context, agentCtx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(agentCtx, ctx)
}

func (p *LineagePIIPlugin) evaluate(agentCtx *engine.AgentContext, ctx context.Context) *engine.RuleResult {
	if p.client == nil || agentCtx == nil || agentCtx.DatasetURN == "" {
		return nil
	}

	callCtx := ctx
	if callCtx == nil {
		callCtx = context.Background()
	}

	graph, err := p.client.GetLineage(callCtx, agentCtx.DatasetURN, true, 2) // upstream, up to 2 hops
	if err != nil {
		return warnOrSkip(p.client, p.Name(), fmt.Sprintf("Could not verify lineage for %s: %v", agentCtx.DatasetURN, err))
	}

	tags := graph.FlattenLineageTags()
	for _, tag := range tags {
		short := shortName(tag)
		switch {
		case strings.EqualFold(short, "PII"):
			return result(p.Name(), DecisionBlock, string(engine.SeverityCritical),
				fmt.Sprintf("Dataset %s derives from a PII-tagged upstream asset. Access blocked by ARGUS lineage policy.", agentCtx.DatasetURN))
		case strings.EqualFold(short, "Sensitive"):
			return result(p.Name(), DecisionBlock, string(engine.SeverityHigh),
				fmt.Sprintf("Dataset %s derives from a Sensitive-tagged upstream asset. Access blocked by ARGUS lineage policy.", agentCtx.DatasetURN))
		case strings.EqualFold(short, "PHI"):
			return result(p.Name(), DecisionBlock, string(engine.SeverityCritical),
				fmt.Sprintf("Dataset %s derives from a PHI-tagged upstream asset (health data). Access blocked.", agentCtx.DatasetURN))
		}
	}
	return nil
}

// --- Policy (GDPR / HIPAA / compliance) ---

// PolicyPlugin warns or blocks based on compliance tags attached to the asset
// itself (GDPR, HIPAA, PCI, etc.). By default these produce a WARN so normal
// flows are not disrupted; set `block bool` for fail-closed deployments.
type PolicyPlugin struct {
	client *Client
	block  bool
}

// NewPolicyPlugin creates the policy detector. When block is true, compliance
// tags block the tool call (KILL_RUN) instead of warning.
func NewPolicyPlugin(client *Client, block bool) *PolicyPlugin {
	return &PolicyPlugin{client: client, block: block}
}

// Name implements engine.DetectorPlugin.
func (p *PolicyPlugin) Name() string { return "DataHub Policy Enforcement (GDPR/HIPAA)" }

// Evaluate implements the context-free interface.
func (p *PolicyPlugin) Evaluate(ctx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(ctx, nil)
}

// EvaluateWithContext implements engine.ContextAwareDetector.
func (p *PolicyPlugin) EvaluateWithContext(ctx context.Context, agentCtx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(agentCtx, ctx)
}

func (p *PolicyPlugin) evaluate(agentCtx *engine.AgentContext, ctx context.Context) *engine.RuleResult {
	if p.client == nil || agentCtx == nil || agentCtx.DatasetURN == "" {
		return nil
	}

	callCtx := ctx
	if callCtx == nil {
		callCtx = context.Background()
	}

	asset, err := p.client.GetEntity(callCtx, agentCtx.DatasetURN)
	if err != nil {
		return warnOrSkip(p.client, p.Name(), fmt.Sprintf("Could not verify policies for %s: %v", agentCtx.DatasetURN, err))
	}
	if asset == nil {
		return nil
	}

	for _, tag := range asset.Tags {
		short := shortName(tag)
		if strings.EqualFold(short, "GDPR") {
			decision := DecisionWarn
			sev := string(engine.SeverityHigh)
			if p.block {
				decision = DecisionBlock
				sev = string(engine.SeverityCritical)
			}
			return result(p.Name(), decision, sev,
				fmt.Sprintf("Dataset %s is GDPR-restricted. Agent access requires explicit approval.", agentCtx.DatasetURN))
		}
		if strings.EqualFold(short, "HIPAA") {
			decision := DecisionWarn
			sev := string(engine.SeverityHigh)
			if p.block {
				decision = DecisionBlock
				sev = string(engine.SeverityCritical)
			}
			return result(p.Name(), decision, sev,
				fmt.Sprintf("Dataset %s is HIPAA-restricted. Agent access requires explicit approval.", agentCtx.DatasetURN))
		}
	}
	return nil
}

// --- Data Quality ---

// QualityPlugin warns when the dataset's DataHub quality score drops below the
// configured threshold (default 0.7). Warnings never block execution.
type QualityPlugin struct {
	client    *Client
	threshold float64
}

// NewQualityPlugin creates the quality detector.
func NewQualityPlugin(client *Client) *QualityPlugin {
	return &QualityPlugin{client: client, threshold: 0.7}
}

// Name implements engine.DetectorPlugin.
func (p *QualityPlugin) Name() string { return "DataHub Data Quality" }

// Evaluate implements the context-free interface.
func (p *QualityPlugin) Evaluate(ctx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(ctx, nil)
}

// EvaluateWithContext implements engine.ContextAwareDetector.
func (p *QualityPlugin) EvaluateWithContext(ctx context.Context, agentCtx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(agentCtx, ctx)
}

func (p *QualityPlugin) evaluate(agentCtx *engine.AgentContext, ctx context.Context) *engine.RuleResult {
	if p.client == nil || agentCtx == nil || agentCtx.DatasetURN == "" {
		return nil
	}

	callCtx := ctx
	if callCtx == nil {
		callCtx = context.Background()
	}

	asset, err := p.client.GetEntity(callCtx, agentCtx.DatasetURN)
	if err != nil {
		return warnOrSkip(p.client, p.Name(), fmt.Sprintf("Could not verify quality for %s: %v", agentCtx.DatasetURN, err))
	}
	if asset == nil || asset.QualityScore == nil {
		return nil // no quality signal exposed
	}
	if *asset.QualityScore < p.threshold {
		return result(p.Name(), DecisionWarn, string(engine.SeverityMedium),
			fmt.Sprintf("Dataset %s has a low DataHub quality score (%.2f < %.2f). Results may be unreliable.", agentCtx.DatasetURN, *asset.QualityScore, p.threshold))
	}
	return nil
}

// --- Deprecation ---

// DeprecationPlugin blocks access to datasets marked deprecated in DataHub.
type DeprecationPlugin struct {
	client *Client
}

// NewDeprecationPlugin creates the deprecation detector.
func NewDeprecationPlugin(client *Client) *DeprecationPlugin {
	return &DeprecationPlugin{client: client}
}

// Name implements engine.DetectorPlugin.
func (p *DeprecationPlugin) Name() string { return "DataHub Deprecation Check" }

// Evaluate implements the context-free interface.
func (p *DeprecationPlugin) Evaluate(ctx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(ctx, nil)
}

// EvaluateWithContext implements engine.ContextAwareDetector.
func (p *DeprecationPlugin) EvaluateWithContext(ctx context.Context, agentCtx *engine.AgentContext) *engine.RuleResult {
	return p.evaluate(agentCtx, ctx)
}

func (p *DeprecationPlugin) evaluate(agentCtx *engine.AgentContext, ctx context.Context) *engine.RuleResult {
	if p.client == nil || agentCtx == nil || agentCtx.DatasetURN == "" {
		return nil
	}

	callCtx := ctx
	if callCtx == nil {
		callCtx = context.Background()
	}

	asset, err := p.client.GetEntity(callCtx, agentCtx.DatasetURN)
	if err != nil {
		return warnOrSkip(p.client, p.Name(), fmt.Sprintf("Could not verify deprecation for %s: %v", agentCtx.DatasetURN, err))
	}
	if asset != nil && asset.Deprecated {
		return result(p.Name(), DecisionBlock, string(engine.SeverityHigh),
			fmt.Sprintf("Dataset %s is deprecated in DataHub. Use an alternative asset instead.", agentCtx.DatasetURN))
	}
	// Teams commonly mark retired tables with a Deprecated tag (there is no
	// MCP set_lifecycle_stage tool, so the tag is the realistic signal).
	if asset != nil && hasTag(asset.Tags, "", "Deprecated") {
		return result(p.Name(), DecisionBlock, string(engine.SeverityHigh),
			fmt.Sprintf("Dataset %s is tagged Deprecated in DataHub. Use an alternative asset instead.", agentCtx.DatasetURN))
	}
	return nil
}
