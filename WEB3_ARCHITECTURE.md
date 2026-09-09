# LINGER — Web3 Architecture

**Status: contract implemented and locally tested. Nothing is deployed, nothing is audited,
and the scene is not connected to it. `LINGER_CHAIN_ENABLED` defaults to `false` and LINGER
is fully playable with the whole layer off.**

This document records the blockchain decision and why it was made. It was written after
inspecting the installed SDK and reading current Decentraland documentation — not from
memory, and not from older SDK6-era examples.

---

## 0. The product principle this serves

LINGER is not a token project, not an NFT game, and not wallet-gated. Blockchain exists
here for exactly one job: **making a human connection permanently verifiable.**

| Off-chain, always | On-chain, optional |
|---|---|
| Echoes, and their 24-hour expiry | A Bond provenance record |
| Hearts, High-fives, notes | |
| Live presence, waves | |
| **Bond creation itself** | |
| Return activity | |

No wallet transaction is required to enter LINGER, see Echoes, create an Echo, interact
with an Echo, or create a Bond. A Bond exists the moment two people earn it. Preservation
is a later, optional, explicitly-initiated act.

---

## 1. What the research actually found

### The SDK's blockchain surface (verified in `node_modules`)

| Capability | Where |
|---|---|
| `createEthereumProvider()` | `@dcl/sdk/ethereum-provider` — an EIP-1193-style provider over the player's wallet |
| `sendAsync(method, jsonParams)` | `~system/EthereumController` — raw JSON-RPC passthrough |
| `signMessage({ [key]: string })` | `~system/EthereumController` — signs a **flat string dict**, not arbitrary EIP-712 typed data |
| `getUserAccount()` | `~system/EthereumController` |
| `eth-connect` | already present as an SDK dependency (6.4.0) |

Two things matter here and are easy to get wrong:

- **`signMessage` is not EIP-712.** It takes a flat key/value dictionary. Typed-data
  signing has to go through `sendAsync` with `eth_signTypedData_v4`, which depends on the
  explorer's provider.
- **`eth-connect`, not ethers, is the documented SDK7 client.** The SDK's own JSDoc shows
  an `ethers.providers.Web3Provider` example (ethers **v5** API), but the current
  Decentraland creator docs recommend `eth-connect` with `RequestManager` / `ContractFactory`.
  The server already has ethers v5 from the donor; the scene has `eth-connect` transitively.

### Target chain

**Polygon PoS.**

Decentraland has a standing partnership with Polygon and treats it as the second layer for
in-world transactions. The documentation is explicit that Ethereum mainnet transactions
triggered by a scene "will require a player to approve and pay a gas fee" — which is
disqualifying for a mobile-first experience where the whole point is that preservation
should feel like a small emotional gesture, not a purchase.

### Gas: meta-transactions, not player-paid gas

Decentraland's own path is a **meta-transaction relayer**: the player signs EIP-712 typed
data, a transactions server forwards it to **Gelato**, and Gelato submits and pays. On the
contract side this is Polygon's `executeMetaTransaction` / `NativeMetaTransaction` pattern —
the contract recovers the signer from the EIP-712 signature and treats them as the caller.
The client library is `decentraland-transactions` (`sendMetaTransaction`), currently 3.1.1.

This is the single most important finding: **the player signs, and pays nothing.**

---

## 2. Decision

| Decision | Choice |
|---|---|
| Chain | **Polygon PoS** (Amoy testnet first) |
| Transaction model | **EIP-712 meta-transaction**, `executeMetaTransaction`, relayer-paid |
| Relayer | Decentraland transactions-server → Gelato, or a LINGER-operated equivalent |
| Contract standard | **Plain custom contract. No token, no NFT, no ERC-anything.** |
| Wallet interaction | `createEthereumProvider()` for the signature only |
| Client library | `decentraland-transactions` for `sendMetaTransaction`; `eth-connect` for reads |
| Default | **Disabled.** `LINGER_CHAIN_ENABLED=false` |

### Why not an NFT

A Bond is a relationship between two people. Minting it as a transferable ERC-721 would
make it sellable, which is incoherent — you cannot sell the fact that you met someone. It
would also force a choice of *which* of the two people owns it. A plain non-transferable
record with two participant addresses is the honest data model, and it is cheaper.

### Why not player-paid mainnet gas

It would make the emotional peak of the product cost real money and require a mainnet
confirmation on a phone. That is the opposite of the intended feeling.

---

## 3. The on-chain record

Minimal by design. Nothing personal, nothing large, nothing that could ever need deleting.

```solidity
// bondRef (keccak256 of worldId + bond number) is the mapping key, not a stored field —
// storing it inside the struct would pay for a slot that the key already provides.
mapping(bytes32 => Bond) private _bonds;

struct Bond {
    address playerA;      // lower of the two addresses; ordering is canonical, not meaningful
    address playerB;      // higher of the two
    bytes32 worldHash;    // keccak256(worldId)
    uint64  createdAt;    // block timestamp
    uint16  version;      // record format version
}
```

`playerA`, `playerB` and `worldHash` occupy their own slots; `createdAt` and `version` pack
into one. Three slots per Bond.

**Never stored on-chain:** notes, Echo history, Echo contents, player positions,
per-interaction timestamps, display names, or any free-form user string.

`bondRef` is a hash, not a lookup key into anything public. A reader of the chain sees that
two addresses formed a Bond in some World at some time. They cannot recover the World's
name, the note, or anything either person did — unless they already hold the off-chain
data, in which case they can verify it matches.

### What is deliberately *not* private

Two wallet addresses and a timestamp are public and permanent. That is the entire point of
provenance, and it is why preservation must be opt-in per person and clearly explained
before it happens. See §5.

---

## 4. The contract

**Implemented and locally tested: `contracts/LingerBond.sol`. Not deployed, not audited.**

```solidity
function createBond(
    bytes32 bondRef,
    address playerA,
    address playerB,
    bytes32 worldHash,
    uint256 deadline,
    bytes calldata consentA,   // playerA's EIP-712 BondConsent signature
    bytes calldata consentB    // playerB's, over the identical struct
) external;

function bondOf(bytes32 bondRef) external view returns (Bond memory);
function bondRefForPair(bytes32 worldHash, address a, address b) external view returns (bytes32);
function consentDigest(...) external view returns (bytes32);
```

**Design change from the original sketch.** The sketch had one participant call via
`executeMetaTransaction` and supply only the partner's signature, so authorisation depended
on `_msgSender()`. The implementation requires **both** signatures explicitly and ignores
the caller entirely. The cost is one extra signature; the benefit is that the
meta-transaction path carries no authority at all, so even a complete failure of it could
not record a Bond both people had not signed. `executeMetaTransaction` is still implemented
for Decentraland relayer compatibility.

Security properties intended:

- **Duplicate-proof:** `_bonds[bondRef]` is written once; a second attempt reverts. A pair
  is additionally unique per World.
- **Two-person consent enforced in the contract**, not merely in our UI — both EIP-712
  signatures are recovered and checked against the named participants.
- **No admin, no owner, no upgradeability, no pause, no mint.** There are no privileged
  functions to document because there are none.
- **Non-transferable.** There is no transfer function; a proof is not an asset.
- **Deadline** on the partner signature, so a consent cannot be held and used months later.
- Signature verification uses OpenZeppelin `ECDSA` rather than hand-rolled `ecrecover`.

**Done since:** 52 Foundry tests including 5 fuzz properties, covering replay, duplicates,
expired deadlines, wrong partners, malformed signatures, cross-chain and cross-contract
signature reuse, and every parameter-substitution attack a relayer could attempt. Full
review in [`CONTRACT_SECURITY.md`](./CONTRACT_SECURITY.md).

**Still needed before deployment:** an independent audit, and confirmation that the
Decentraland mobile client can actually produce EIP-712 signatures.

---

## 5. Consent

A Bond is created by two people being present together. Preservation is a separate,
explicit act, and it needs consent from **both**.

```
Bond exists off-chain (already true, always)
        │
   A taps "Preserve this memory"      ── authenticated request, verified identity
        │
   B is asked, and taps "Preserve"    ── authenticated request, verified identity
        │
   both consented → adapter invoked
        │
   A signs EIP-712 (meta-tx), carrying B's EIP-712 consent signature
        │
   relayer submits, pays gas
        │
   confirmed → server records the proof reference against Bond #0001
```

Consent at the LINGER level reuses **the existing authenticated identity** — the
`signedFetch` → ticket → Colyseus binding already built and tested. No second identity
system is introduced. A consent request from a session whose verified identity is not a
participant in that Bond is rejected.

Nobody is ever surprised by an irreversible transaction: the second player is *asked*, the
card states plainly what becomes public, and either person can decline. Declining leaves
the Bond exactly as it was.

---

## 6. Mobile implications

- The player **signs**, never sends a transaction, so there is no gas prompt and no
  balance requirement.
- One card, one explanation, one primary action, one dismissal. No wallet dashboard, no
  network switcher, no address display.
- The language stays *memory*, *bond*, *preserve*. Not *mint*, *token*, *asset*, *gas*.
- Guests without a wallet simply do not see the preserve action. They lose nothing else.
- **Known mobile risk:** wallet-signature UX inside the Decentraland mobile client is the
  least-proven part of this design. It is why preservation is optional and why failure is
  a non-event.

---

## 7. Failure handling

The gameplay Bond is the source of truth and is **never** affected by chain outcomes.

| Failure | Behaviour |
|---|---|
| Chain disabled | No preserve action is offered at all |
| Relayer/RPC unreachable | `FAILED`, retryable, Bond untouched |
| Player rejects the signature | Returns to `NOT_PRESERVED`, no error shown as a failure |
| Partner never consents | Stays `NOT_PRESERVED` |
| Timeout | `FAILED`, retryable |
| Duplicate submission | Refused before dispatch; contract also reverts |
| Contract revert | `FAILED`, message recorded, Bond untouched |
| Reorg | The proof is only recorded after the configured confirmation depth |

Copy on failure: *"Your Bond is still here. We couldn't preserve it on-chain yet."*

The status is never reported as `PRESERVED` until a confirmation is actually observed. A
submitted-but-unconfirmed transaction is `PRESERVING`, not preserved.

---

## 8. Measured cost

**Measured by `forge test --gas-report`, not estimated.** The earlier rough figure in this
document has been replaced.

| Operation | Gas |
|---|---|
| `createBond` — successful, first Bond | **150,723** |
| `createBond` — duplicate rejected | 3,480 |
| `executeMetaTransaction` wrapping a creation | **188,366** |
| `bondOf` lookup (view) | 2,219 |
| `bondRefForPair` lookup (view) | 3,089 |
| `consentDigest` (view) | 1,218 |
| Deployment | 934,411 |

A real relayed transaction is the meta-transaction figure plus the 21,000 base cost:
**≈ 209,000 gas**. Submitted directly by a participant instead, it is ≈ 172,000.

On Polygon at 30–100 gwei that is **0.0063–0.021 POL**. At a POL price in the 0.15–0.50 USD
range: roughly **$0.001–$0.010 per preserved Bond**, before relayer margin.

Views are free when called off-chain via `eth_call`; the figures above are the on-chain
costs if another contract were to read them.

The player pays **zero** in the intended architecture — the relayer pays. Confirmed by
`test_metaTransaction_userNeedsNoFunds`, which records a Bond for a signer holding no funds
at all.

## 9. Security considerations

- **Identity is not re-derived.** The blockchain layer consumes the already-authenticated
  identity from the existing signature→ticket→session binding. A wallet address sent by a
  client is never trusted, and there is no second identity path.
- **A participant check gates every consent.** Only the two identities recorded on the Bond
  can consent to preserving it.
- **The relayer cannot forge a Bond** that the contract will accept without a valid partner
  signature — but note the trust boundary in §10.
- **No private keys in the repository, ever.** The relayer key and RPC credentials are
  environment-only. Nothing is committed.
- **No arbitrary user storage on-chain**, so there is no vector for storing hostile content
  in a permanent public place.
- **Rate limiting** on consent requests reuses the existing per-identity limiter.

---

## 10. Honest trust boundary

The contract can verify that two **wallets** consented. It cannot verify that those wallets
are the two people LINGER actually saw standing together — that fact lives off-chain, in
the server's Bond record.

So a preserved Bond proves: *these two wallets both agreed to record a Bond with this
reference.* It does not prove, on-chain, that the meeting happened as LINGER describes. A
dishonest LINGER operator could ask two colluding wallets to sign.

This is the normal limit of an oracle-free design and it should be stated plainly rather
than dressed up. Closing it would need the server to attest on-chain as a named signer,
which adds a trusted key and is not obviously worth it for an MVP.

---

## 11. Configuration

Disabled by default. Nothing is attempted until every value is set.

| Variable | Default | Purpose |
|---|---|---|
| `LINGER_CHAIN_ENABLED` | `false` | master feature flag |
| `LINGER_CHAIN_NETWORK` | `polygon-amoy` | target network |
| `LINGER_CHAIN_RPC_URL` | unset | read provider |
| `LINGER_BOND_CONTRACT` | unset | deployed contract address |
| `LINGER_CHAIN_PROTOCOL_VERSION` | `1` | on-chain record version |
| `LINGER_RELAYER_URL` | unset | meta-transaction relayer |
| `LINGER_CHAIN_CONFIRMATIONS` | `3` | confirmations before reporting PRESERVED |

If `LINGER_CHAIN_ENABLED=true` with anything missing, the server refuses to start rather
than silently running a half-configured chain layer.

---

## 12. Explicitly out of scope

No LINGER token. No reward token, staking, liquidity, marketplace, or speculative economy.
No Kindling. No cross-World Bond propagation — a Bond belongs to its World, and a
cross-World protocol is future work, documented nowhere but here as a possibility.

---

## 13. What has to happen before this is real

1. Review this document.
2. ~~Write the contract with a Foundry test suite~~ — **done**: `contracts/LingerBond.sol`,
   52 tests, [`CONTRACT_SECURITY.md`](./CONTRACT_SECURITY.md). Independent review still needed.
3. Deploy to **Polygon Amoy** testnet only.
4. Verify meta-transaction signing actually works inside the Decentraland **mobile** client —
   this is the biggest unknown and the most likely thing to fail.
5. Only then consider mainnet.

Until step 3 completes, `LINGER_CHAIN_ENABLED` stays `false`, the preserve action is not
offered, and LINGER behaves exactly as it does today.

---

## Sources

- [Scene blockchain operations — Decentraland Docs](https://docs.decentraland.org/creator/scenes-sdk7/blockchain/scene-blockchain-operations.md)
- [Second layer blockchain — Decentraland Docs](https://docs.decentraland.org/creator/scenes-sdk7/blockchain/second-layer)
- [Deploying your own transactions server — Decentraland Docs](https://docs.decentraland.org/creator/scenes-sdk7/blockchain/deploying-your-own-transactions-server)
- [Transactions in Polygon — Decentraland Docs](https://docs.decentraland.org/player/blockchain-integration/transactions-in-polygon/)
- [Meta transactions — decentraland/marketplace wiki](https://github.com/decentraland/marketplace/wiki/Meta-transactions)
- [Meta transactions — Polygon Developer Docs](https://docs.polygon.technology/pos/concepts/transactions/meta-transactions/)
- [`decentraland-transactions` — npm](https://www.npmjs.com/package/decentraland-transactions)
