# LingerBond — Security Review

**Contract:** `contracts/LingerBond.sol`
**Status: written, locally tested, NOT deployed and NOT audited.** No address exists on any
network. Nothing in the live LINGER scene talks to it.

---

## 0. The one sentence that matters

> **The contract does not independently prove that the two wallets physically met inside
> LINGER.**

It records that two wallets each signed a statement agreeing to a Bond. The claim that
those two people actually spent time together is made by LINGER's off-chain server, which
observed their live presence, and is not verifiable on-chain by anyone.

Anything built on top of this registry must repeat that distinction rather than blur it.

---

## 1. Threat model

| # | Adversary | Goal | Outcome |
|---|---|---|---|
| T1 | Malicious relayer | Record a Bond nobody consented to | **Blocked** — needs two valid signatures |
| T2 | Malicious relayer | Insert itself as a participant beside a real signer | **Blocked** — the consent binds both addresses |
| T3 | Malicious relayer | Alter bondRef, worldHash, or the deadline in flight | **Blocked** — every field is inside the signed struct |
| T4 | Any caller | Forge a participant's consent | **Blocked** — ECDSA recovery must equal the named participant |
| T5 | Any caller | Replay a captured consent pair | **Blocked** — bondRef is single-use, plus a deadline |
| T6 | Any caller | Replay a consent on another chain or another deployment | **Blocked** — domain separator binds chainId and address |
| T7 | Any caller | Replay a captured meta-transaction | **Blocked** — per-signer nonce |
| T8 | Participant | Bond with themselves | **Blocked** — `IdenticalParticipants` |
| T9 | Participant | Create a second Bond with the same person to inflate a count | **Blocked** — pair is unique per World |
| T10 | Anyone | Modify or delete a recorded Bond | **Blocked** — no such function exists |
| T11 | Contract deployer | Retain privileged control | **Blocked** — no owner, no admin, no roles |
| T12 | Anyone | Write hostile text into permanent public storage | **Blocked** — no string or bytes field is stored |
| T13 | LINGER operator | Manufacture a Bond between two colluding wallets | **NOT blocked** — see §10 |
| T14 | Griefer | Burn a bondRef before the real pair uses it | **Partially** — see §12.1 |

---

## 2. Trust assumptions

1. **secp256k1 / ECDSA is sound**, as implemented by OpenZeppelin's audited `ECDSA` library.
   No signature primitive is hand-rolled here.
2. **Participants control their own keys.** A compromised wallet can consent to anything;
   that is outside any contract's reach.
3. **`block.timestamp` is approximately honest.** Only used for a coarse deadline and the
   recorded `createdAt`; a validator can nudge it by seconds, which is immaterial at the
   granularity of a consent window.
4. **The relayer is untrusted.** It can censor (refuse to submit) or delay. It cannot forge.
5. **LINGER's server is trusted for the meaning of a Bond**, not for its authorisation. See §10.

---

## 3. Authentication model

Authorisation is **purely signature-based** and deliberately ignores `msg.sender`.

Both participants sign the identical EIP-712 struct:

```
BondConsent(bytes32 bondRef,address playerA,address playerB,bytes32 worldHash,uint256 deadline)
```

with the Decentraland/Polygon domain:

```
EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)   salt = chainId
```

`createBond` recovers both signers and requires them to equal the two named participants,
in canonical (ascending address) order. Whoever submits the transaction — a relayer, a
stranger, or a participant — has no bearing on whether it succeeds.

**Why not derive one party from `msg.sender` / `_msgSender()`?** It would work, but it makes
authorisation depend on the meta-transaction machinery being correct. Requiring both
signatures explicitly means that even a total failure of `executeMetaTransaction` could not
produce a Bond that both people had not signed. The cost is one extra signature; the
benefit is that the meta-transaction path carries no authority at all.

Tested by: `test_strangerMaySubmitFullyConsentedBond`, `test_revert_relayerInsertsItselfAsParticipant`,
`test_metaTransaction_cannotBypassConsent`.

---

## 4. Replay protection

Four independent layers:

| Layer | Mechanism | Test |
|---|---|---|
| Same Bond twice | `bondRef` is a one-time slot | `test_revert_sameBondRefTwice` |
| Same pair twice | `pairKey` unique per `(worldHash, low, high)` | `test_revert_samePairDifferentBondRef` |
| Stale consent | `deadline` checked against `block.timestamp` | `test_revert_consentGoesStale` |
| Cross-chain / cross-deployment | domain separator binds `chainId` and `address(this)` | `test_revert_signatureFromAnotherChain`, `test_revert_signatureFromAnotherContract` |

Meta-transactions add a per-signer nonce (`test_revert_metaTransaction_replay`).

Signature malleability is rejected: OpenZeppelin's `ECDSA` refuses high-`s` values and the
zero address, unlike the bare `ecrecover` in Decentraland's reference `NativeMetaTransaction`.

---

## 5. Duplicate prevention

Two separate keys, both checked before any write:

- `_bonds[bondRef]` — a bondRef can be used exactly once, ever.
- `_pairBond[keccak256(worldHash, low, high)]` — a pair can bond once per World.

Participants are sorted by address before either key is computed, so `(A,B)` and `(B,A)` are
the same Bond everywhere: in the signed struct, in storage, and in lookups.

**Pair uniqueness is scoped per World** rather than globally, matching the off-chain server,
where a Bond belongs to the World it was formed in. The same two people can bond in two
different Worlds. Tested by `test_samePairInAnotherWorldIsAllowed`.

---

## 6. Relayer assumptions

The relayer pays gas and is otherwise powerless:

- **Cannot forge** — it holds no participant key.
- **Cannot substitute** any parameter — all are inside both signatures.
- **Cannot front-run profitably** — there is nothing to extract; submitting the correct
  transaction is the only thing it can do, and doing so is the intended outcome.
- **Can censor** — it may simply refuse. Mitigation: a participant can submit the same
  transaction themselves and pay their own gas. The contract does not care who calls.
- **Can be replaced** — any relayer works, including Decentraland's transactions server via
  `executeMetaTransaction`, Gelato, or a plain EOA calling `createBond` directly.

---

## 7. Immutability guarantees

Once written, a Bond is permanent. This is enforced structurally, not by a modifier:

- There is **no** setter, updater, deleter, `selfdestruct`, or delegatecall.
- The only write to `_bonds` is in `_record`, which is only reachable through `createBond`,
  which reverts if the slot is occupied.
- No proxy, no upgrade path, no initialiser — the constructor runs once and the domain
  separator is `immutable`.

Tested by `test_immutable_noMutatingFunctionsExist` and `test_immutable_survivesTimeAndOtherBonds`.

---

## 8. Privacy limitations

**Chain data is permanently public and cannot be deleted.** A Bond permanently associates
two wallet addresses in public, with a timestamp.

Stored: two addresses, `worldHash`, `createdAt`, `version`.
Never stored: names, notes, Echo content or history, positions, session ids, realm ids, IP
addresses, or any free-form string.

`bondRef` and `worldHash` are hashes. An observer cannot recover the World's name or the
Bond number from them without already knowing the input — though note that a World name is
low-entropy and **trivially brute-forced** if an attacker guesses candidates. The hashing
is compaction and tidiness, **not confidentiality**. Do not present it as privacy.

The genuinely sensitive disclosure is the address pair itself, and it is unavoidable: it is
the entire content of the provenance claim. This is why preservation must be opt-in from
both people and clearly explained beforehand.

---

## 9. What the chain proves

- Two specific addresses each produced a valid signature over the same consent struct.
- They did so before `deadline`, for this contract, on this chain.
- The record was written at `createdAt` and has never changed since.
- No third party altered any field between signing and recording.

---

## 10. What the chain does NOT prove

- **That the two people met in LINGER.** Not provable on-chain. LINGER's server observed it;
  the chain only sees the resulting consent.
- **That the addresses belong to distinct humans.** One person with two wallets can bond
  with themselves. The off-chain layer resists this via verified Decentraland identity and
  live-presence requirements; the contract cannot.
- **That the `worldHash` corresponds to a real Decentraland World.**
- **That LINGER's server behaved honestly.** A dishonest operator could solicit consents
  from two colluding wallets and record a Bond describing a meeting that never happened.

Closing the last point would require the server to be a named on-chain attestor, adding a
trusted key and a privileged role. That was rejected: it trades a clearly-stated limitation
for a privileged role, which is a worse position for a registry whose main virtue is having
no privileged roles at all.

---

## 11. Admin privileges

**None.** There is no owner, admin, operator, pauser, upgrader, minter, or fee recipient.
There is no function only some addresses may call. Deploying the contract confers no
ongoing power whatsoever, including on the deployer.

This is deliberate and is the single most important structural property: nothing can be
turned off, censored at the contract level, seized, or rewritten later.

---

## 12. Known limitations

### 12.1 bondRef griefing

Anyone who learns a `bondRef` before the real pair submits could, with two wallets they
control, consume that slot — but only for **their own** pair, since the consent binds the
participants. The genuine pair would then hit `BondRefAlreadyUsed` and have to be issued a
fresh `bondRef` by the server.

Impact: nuisance, not loss. The off-chain Bond is untouched, and the server can mint a new
reference. It requires knowing an unpublished hash in advance. Not mitigated in the
contract; deliberately, since the fix (binding bondRef to the participants) would remove
the server's freedom to choose references.

### 12.2 Pair uniqueness is per World

If two people bond in several Worlds they get several records. Intended, and consistent
with the off-chain model, but it means "number of Bonds" is not "number of relationships".

### 12.3 No revocation

A Bond cannot be withdrawn. That is the point of provenance, and it is why consent must be
informed. There is no "forget me" and there cannot be.

### 12.4 Timestamp granularity

`createdAt` is a block timestamp, manipulable by a validator within a few seconds. It is
descriptive, not load-bearing.

### 12.5 Single-signature meta-transaction path is unused

`executeMetaTransaction` exists for relayer compatibility but confers no authority. It
increases the code surface for a convenience. It is retained because Decentraland's
transactions server expects that exact interface; a deployment using a plain relayer could
drop it entirely and lose nothing.

### 12.6 Not audited

Reviewed by its author and covered by 52 local tests including 5 fuzz properties. That is
not an audit.

---

## 13. Future audit requirements

Before any mainnet deployment:

1. **Independent audit** of `LingerBond.sol`, focused on the EIP-712 encoding, the ordering
   normalisation, and the `executeMetaTransaction` self-call.
2. **Amoy testnet deployment** and end-to-end exercise with the real relayer.
3. **Verify the domain separator** matches what `decentraland-transactions` produces —
   a mismatch would make every relayed signature fail, and the salt-instead-of-chainId
   convention is easy to get wrong.
4. **Confirm the Decentraland mobile client can produce EIP-712 signatures.** `signMessage`
   in `~system/EthereumController` takes a flat string dict and is *not* EIP-712; typed data
   must go through `sendAsync` + `eth_signTypedData_v4`, whose mobile support is unverified.
   **This is the largest open risk in the whole design.**
5. **Decide the relayer operating model** and fund it.
6. Consider `forge fmt --check` and a Slither pass in CI.

---

## 14. Test coverage summary

52 tests, 0 failures, 5 fuzz properties at 512 runs each.

| Area | Tests |
|---|---|
| Creation, retrieval, events | 7 |
| Invalid input (zero ref/addresses, self-bond) | 4 |
| Duplicates (ref, pair, reversed, cross-World) | 6 |
| Immutability | 2 |
| Consent and expiry | 7 |
| Domain binding (contract, chain) | 3 |
| Parameter substitution by a relayer | 6 |
| Submission by any party | 2 |
| Meta-transaction, including replay and consent bypass | 6 |
| Fuzz | 5 |
| Gas | 3 |
