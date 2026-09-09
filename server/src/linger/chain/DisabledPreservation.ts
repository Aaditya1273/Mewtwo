import { BondPreservation, PreserveOutcome, PreserveRequest } from './BondPreservation'

/**
 * The default backend: preservation is switched off.
 *
 * This is what runs in development, in the test suite, and in any deployment that has not
 * finished chain configuration. It exists so that "blockchain disabled" is a first-class,
 * fully-tested state rather than an untested error path.
 */
export class DisabledPreservation implements BondPreservation {
  readonly enabled = false
  readonly network = 'disabled'

  async preserve(_request: PreserveRequest): Promise<PreserveOutcome> {
    // Not retryable: nothing about waiting will turn the feature on.
    return { ok: false, retryable: false, error: 'PRESERVATION_DISABLED' }
  }
}
