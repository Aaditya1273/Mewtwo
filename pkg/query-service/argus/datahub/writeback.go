package datahub

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// EventStore keeps a bounded, in-memory history of governance decisions so the
// dashboard can render them live. It is safe for concurrent use.
type EventStore struct {
	mu     sync.RWMutex
	events []GovernanceEvent
	max    int
}

// NewEventStore returns an event store that keeps up to max entries (oldest
// dropped first).
func NewEventStore(max int) *EventStore {
	if max <= 0 {
		max = 100
	}
	return &EventStore{max: max}
}

// Record appends a governance event.
func (s *EventStore) Record(e GovernanceEvent) {
	if s == nil {
		return
	}
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, e)
	if len(s.events) > s.max {
		s.events = s.events[len(s.events)-s.max:]
	}
}

// All returns a copy of all recorded events, newest first.
func (s *EventStore) All() []GovernanceEvent {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]GovernanceEvent, len(s.events))
	copy(out, s.events)
	// newest first
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// WriteBack writes a governance decision to DataHub as an audit trail:
//  1. Tags the dataset with ARGUS_<DECISION> via the add_tags mutation tool
//     (only when mutation is enabled server-side).
//  2. Records the event in the in-memory EventStore.
//
// Write-back is best-effort: failures never propagate to the caller of the
// original tool call.
func (c *Client) WriteBack(ctx context.Context, store *EventStore, e GovernanceEvent) {
	if e.DatasetURN == "" {
		if store != nil {
			store.Record(e)
		}
		return
	}

	tag := "ARGUS_" + e.Decision
	if err := c.AddTag(ctx, e.DatasetURN, tag); err == nil {
		e.Reason = e.Reason + " (audit tag " + tag + " written to DataHub)"
	} else if err := c.UpdateDescription(ctx, e.DatasetURN, "append",
		fmt.Sprintf("[ARGUS audit] %s — %s", e.Decision, e.Reason), ""); err == nil {
		// ⚠️ INVASIVE: appending to update_description permanently mutates the
		// dataset's description in the shared DataHub catalog. It is a fallback
		// for when the ARGUS_* audit tag URN doesn't exist yet (add_tags then
		// rejects it server-side). Acceptable for the demo; gate behind an env
		// var before production use.
		e.Reason = e.Reason + " (audit note appended to DataHub description)"
	}
	// NOTE: if both write-backs fail (e.g. tag URN does not exist and mutation
	// is disabled), the event is still recorded locally so the dashboard and
	// audit log stay complete. Write-back is always best-effort.
	if store != nil {
		store.Record(e)
	}
}
