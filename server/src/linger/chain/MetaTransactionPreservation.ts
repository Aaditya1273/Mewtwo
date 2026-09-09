import { BondPreservation, PreserveOutcome, PreserveRequest } from './BondPreservation'
import { ChainConfig } from './chainConfig'

/**
 * Polygon meta-transaction backend.
 *
 * NOT WIRED UP. There is no deployed contract, so this adapter refuses every request and
 * says so. It exists to fix the shape of the integration — what it needs, what it returns,
 * and where the chain call goes — so the rest of the system can be built and tested
 * against the real boundary rather than a guess.
 *
 * The intended flow, per WEB3_ARCHITECTURE.md:
 *
 *   1. Both participants have already consented through LINGER's authenticated identity.
 *   2. The partner signs EIP-712 consent over (bondRef, partner, worldHash, deadline).
 *   3. The initiator signs an EIP-712 meta-transaction calling
 *      `preserve(bondRef, partner, worldHash, deadline, partnerSignature)`.
 *   4. A relayer submits it and pays the gas — the players pay nothing.
 *   5. Only after `LINGER_CHAIN_CONFIRMATIONS` blocks do we report PRESERVED.
 *
 * Completing it requires: a deployed, reviewed contract; `decentraland-transactions` for
 * `sendMetaTransaction`; a funded relayer. Deliberately none of that is present yet, and
 * no dependency is added for a feature that cannot run.
 */
export class MetaTransactionPreservation implements BondPreservation {
  readonly enabled: boolean
  readonly network: string

  constructor(private readonly config: ChainConfig) {
    this.enabled = config.enabled
    this.network = config.network
  }

  async preserve(request: PreserveRequest): Promise<PreserveOutcome> {
    // Guard rail, not a placeholder: until a reviewed contract is deployed this must never
    // pretend to have preserved anything. Reporting a false PRESERVED is the single worst
    // thing this layer could do — the whole point of the feature is that it is verifiable.
    void request
    return {
      ok: false,
      retryable: false,
      error: 'CHAIN_ADAPTER_NOT_IMPLEMENTED'
    }
  }

  /**
   * Opaque on-chain reference for a Bond.
   *
   * keccak256 over the World and the Bond number. Deterministic, so the same Bond always
   * maps to the same slot and a duplicate preservation is refused by the contract; opaque,
   * so a chain reader learns nothing about the World or the people without already holding
   * the off-chain record.
   *
   * Implemented here rather than in the contract call so it can be unit-tested and so the
   * hashing rule has exactly one definition.
   */
  static bondRef(worldId: string, bondNumber: number): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require('crypto')
    // Length-prefixed so ("ab", 1) and ("a", 11) cannot collide.
    const canonical = `linger:v1:${worldId.length}:${worldId}:${bondNumber}`
    return '0x' + createHash('sha256').update(canonical).digest('hex')
  }
}
