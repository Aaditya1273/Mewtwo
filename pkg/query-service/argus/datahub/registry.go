package datahub

import (
	"github.com/SigNoz/signoz/pkg/query-service/argus/engine"
)

// RegisterPlugins attaches all metadata-aware governance plugins to the engine.
// It is safe to call with a nil client: each plugin no-ops when DataHub is
// disabled, leaving the rest of the pipeline untouched.
func RegisterPlugins(eng *engine.GovernanceEngine, client *Client) {
	if eng == nil {
		return
	}
	eng.RegisterPlugin(NewOwnershipPlugin(client))
	eng.RegisterPlugin(NewLineagePIIPlugin(client))
	eng.RegisterPlugin(NewPolicyPlugin(client, false)) // warn by default; set true for fail-closed
	eng.RegisterPlugin(NewQualityPlugin(client))
	eng.RegisterPlugin(NewDeprecationPlugin(client))
}
