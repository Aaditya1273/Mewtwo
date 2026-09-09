# Decentraland Meta-Transaction Compatibility Audit

**Subject:** `contracts/LingerBond.sol`
**Audited against:** Decentraland's canonical `NativeMetaTransaction.sol` / `EIP712Base.sol`
(`decentraland/wearables-contracts@master`, saved under `audit/canonical/`) and the
`decentraland-transactions@3.1.1` client.

**The contract was not modified during this audit.** Nothing was deployed. Two test files
and one script were added; `contracts/LingerBond.sol` is byte-identical to the reviewed
commit.

---

## Method

Compatibility was established by **two independent implementations agreeing on a digest**,
not by inspecting typestrings and reasoning that they look alike:

1. Solidity (`test/MetaTxVectors.t.sol`) emits every intermediate value.
2. ethers v5 (`script/crosscheck.js`) recomputes them via `_TypedDataEncoder` — the same
   encoder a wallet uses to service `eth_signTypedData_v4` — and compares.

Where that method could not settle a question, the row below says **UNVERIFIED**.

---

## Results

| # | Check | Status | Evidence | Risk | Required Action |
|---|---|---|---|---|---|
| 1.1 | Domain typestring identical to canonical | **PASS** | Both are `EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)`; grep of `audit/canonical/EIP712Base.sol` vs `contracts/LingerBond.sol` | — | None |
| 1.2 | Domain field order (name, version, verifyingContract, salt) | **PASS** | Matches canonical and `decentraland-transactions` `DOMAIN_TYPE` exactly | — | None |
| 1.3 | `salt` carries chain id, not a `chainId` field | **PASS** | Canonical `bytes32(getChainId())`; LingerBond `bytes32(block.chainid)` — same opcode. Vector: `salt=0x…013882` = 80002 | — | None |
| 1.4 | Chain-id encoding (left-padded 32 bytes) | **PASS** | Solidity `0x…0000013882`; client `getSalt()` → `to32Bytes(chainId.toString(16))` produces the identical string | — | None |
| 1.5 | Domain separator construction | **PASS** | Solidity `0x99c1456d…6da92d95` == ethers `_TypedDataEncoder.hashDomain` — cross-check PASS | — | None |
| 1.6 | `domainSeparator()` getter exists | **PASS** | Selector `0xf698da25`, public immutable | — | None |
| 2.1 | MetaTransaction typestring | **PASS** | `MetaTransaction(uint256 nonce,address from,bytes functionSignature)` — identical to canonical and to client `META_TRANSACTION_TYPE` |  — | None |
| 2.2 | MetaTransaction typehash | **PASS** | `0x23d10def…32e1e653` from both Solidity and ethers | — | None |
| 2.3 | Struct hash uses `keccak256(functionSignature)` for the bytes field | **PASS** | Required by EIP-712 for dynamic types; canonical does the same; ethers agrees on the final digest | — | None |
| 2.4 | Final meta digest | **PASS** | `0xf5c08193…424d6ec9` from both implementations | — | None |
| 3.1 | `getNonce(address)` selector matches the client's hardcoded value | **PASS** | Client hardcodes `2d0335ab`; LingerBond ABI selector is `0x2d0335ab` | — | None |
| 3.2 | Nonce read before signing, incremented on execute | **PASS** | `test_metaTransaction_relayedByThirdParty` asserts nonce 0 → 1 | — | None |
| 3.3 | Nonce replay resistance | **PASS** | `test_revert_metaTransaction_replay` — resubmitting the same signed meta-tx reverts | — | None |
| 3.4 | Per-account nonces | **PASS** | `test_metaTransaction_noncesArePerAccount` | — | None |
| 3.5 | Client parses the nonce correctly | **PASS** | Client does `to32Bytes(eth_call result)` then `parseInt(hex,16)`; a `uint256` return is exactly 32 bytes | — | None |
| 4.1 | `executeMetaTransaction` selector matches the client's hardcoded value | **PASS** | Client hardcodes `0c53c51c`; LingerBond ABI selector is `0x0c53c51c` | — | None |
| 4.2 | Parameter order `(address,bytes,bytes32,bytes32,uint8)` | **PASS** | Selector equality above proves the full signature | — | None |
| 4.3 | Nested `functionSignature` ABI encoding | **PASS** | `createBond` selector `0x10380e4d` and `keccak(functionSignature)=0x8e83d3ed…` agree between Solidity `abi.encodeWithSelector` and ethers `Interface.encodeFunctionData` | — | None |
| 4.4 | Relayer calldata assembles correctly | **PASS** | 708 bytes, selector `0x0c53c51c` (cross-check) | — | None |
| 4.5 | `bytes calldata` vs canonical `bytes memory` | **PASS** | External ABI encoding is identical; selector equality confirms | — | None |
| 4.6 | Canonical is `payable`, LingerBond is not | **PASS (deviation)** | `sendMetaTransaction` POSTs `params:[address,txData]` with no value field, so the relayer sends 0 | Low | None. Note the deviation if a future relayer sends value. |
| 5.1 | BondConsent typestring and field order | **PASS** | `BondConsent(bytes32 bondRef,address playerA,address playerB,bytes32 worldHash,uint256 deadline)`; typehash `0x4aeee9bd…aa7afe8` from both implementations | — | None |
| 5.2 | Struct hash | **PASS** | `0x0e494045…7f0622d2` — Solidity == ethers | — | None |
| 5.3 | Consent digest | **PASS** | `0x0c9e38e1…46f2279d` — Solidity == ethers | — | None |
| 5.4 | Both participants sign the *identical* payload | **PASS** | Addresses are sorted before hashing, so one canonical struct is produced; `test_bondRefForPair_isOrderIndependent`, `test_revert_reversedPairIsTheSameBond` | — | None |
| 5.5 | Contract's `consentDigest()` == manual EIP-712 construction | **PASS** | Asserted in `test_vector_bondConsent` | — | None |
| 6.1 | Deterministic test vector produced | **PASS** | §Test vector below; reproducible via the two commands given | — | None |
| 6.2 | Signature bytes reproduce exactly | **PASS** | `0x93a142fb…1c` and `0xda24913c…1c` identical from `vm.sign` and `ethers._signTypedData` | — | None |
| 6.3 | Recovery is exact | **PASS** | `ethers.verifyTypedData` recovers both addresses; contract reverts on any mismatch | — | None |
| 6.4 | `v` normalisation (Ledger returns 0/1) | **PASS** | Client `normalizeVersion` maps <27 → +27 and rejects anything not in {27,28}; OZ ECDSA requires {27,28} | — | None |
| 6.5 | Signature malleability | **PASS (stricter)** | OZ `ECDSA` rejects high-`s`; canonical bare `ecrecover` does not. LingerBond is strictly stricter, and wallets emit low-`s` | Low | None |
| 7.1 | `eth_signTypedData_v4` payload shape | **PASS** | Reproduced below; matches client `getDataToSign` field for field (types incl. `EIP712Domain`, `primaryType: 'MetaTransaction'`, JSON-stringified) | — | None |
| 7.2 | Payload digest == Solidity verification path | **PASS** | ethers hashes that exact payload to `0xf5c08193…`, which the contract recomputes | — | None |
| 7.3 | SDK provider does not block the method | **PASS** | `@dcl/sdk/internal/provider.js` is a 28-line transparent passthrough with no allowlist | — | None |
| 7.4 | **The Decentraland explorer actually implements `eth_signTypedData_v4`** | **UNVERIFIED** | Not determinable from the repo, the SDK, or the docs. `~system/EthereumController.signMessage` is a flat string dict and is **not** EIP-712 | **HIGH** | Test on a real desktop client, then a real mobile client, before Amoy |
| 8.1 | Wallet → relayer → executeMetaTransaction → createBond digest chain | **PASS (offline)** | Every hop reproduced offline and byte-matched; see §Chain of custody | — | Re-confirm live once 7.4 is settled |
| 8.2 | **DCL's public transactions server will relay to this contract** | **UNVERIFIED** | The transactions-server documents a **whitelisted-contracts** env var. `LingerBond` is not a Decentraland contract and cannot be on their list | **MEDIUM** | Run our own transactions-server instance, or another relayer |
| 8.3 | Client `contractData` can be supplied for a non-registry contract | **PASS** | `sendMetaTransaction(provider, metaTxProvider, functionSignature, contractData, config)` takes `contractData` as an argument; `name`/`version` must be `"LingerBond"`/`"1"` to match the contract's domain | Low | Pass the correct `contractData`; a mismatch silently breaks every signature |
| 8.4 | Smart-contract (EIP-1271) wallets | **FAIL by design** | Client throws `Contract accounts are not supported`; LingerBond uses OZ ECDSA with no EIP-1271 path | Low | Accept: EOA-only. Document for users. |
| 8.5 | Canonical `getChainId()` public getter absent from LingerBond | **PASS** | The client computes `salt` from its configured `chainId` and never calls `getChainId()` | Low | None. Third-party tooling expecting it would need it added. |
| 9.1 | Relayer cannot alter `bondRef` | **PASS** | `test_revert_relayerSwapsBondRef` | — | None |
| 9.2 | Relayer cannot alter `playerA`/`playerB` | **PASS** | `test_revert_relayerSwapsParticipant`, `test_revert_relayerInsertsItselfAsParticipant` | — | None |
| 9.3 | Relayer cannot alter `worldHash` | **PASS** | `test_revert_relayerSwapsWorldHash` | — | None |
| 9.4 | Relayer cannot alter `deadline` | **PASS** | `test_revert_relayerExtendsDeadline` | — | None |
| 9.5 | Relayer cannot swap or reuse a signature | **PASS** | `test_revert_consentsSwapped`, `test_revert_thirdPartySignsForB` | — | None |
| 10.1 | One participant's authorization cannot create a Bond | **PASS** | `test_metaTransaction_cannotBypassConsent` — Alice signs the meta-tx and supplies her own consent twice; reverts, nothing recorded | — | None |
| 10.2 | `executeMetaTransaction` confers no authority | **PASS** | Authorization reads neither `msg.sender` nor an appended `_msgSender()`; both consent signatures are required regardless of caller | — | None |
| 10.3 | Anyone may submit a fully-consented Bond | **PASS (by design)** | `test_strangerMaySubmitFullyConsentedBond` — this is what makes relaying possible and censorship survivable | — | None |

**Totals: 40 PASS, 2 UNVERIFIED, 1 FAIL-by-design (EOA-only, accepted).**

---

## No incompatibility was found

Every check that could be settled offline passed. The two UNVERIFIED rows are **not**
incompatibilities in the contract — they are facts about the Decentraland client and the
Decentraland relay operator that cannot be established without touching a real client or a
real relayer. They are stated as unknowns rather than assumed either way.

The contract was not changed to make any assumption disappear.

---

## Deterministic test vector

All private keys below are **test-only constants**. They hold nothing.

```
chainId                80002                (Polygon Amoy)
verifyingContract      0xFb1b848e938aE6474F890bfb28f6a793a515BAcb
EIP-712 name           "LingerBond"
EIP-712 version        "1"
salt                   0x0000000000000000000000000000000000000000000000000000000000013882

privateKey A           0x00000000000000000000000000000000000000000000000000000000000a11ce
privateKey B           0x0000000000000000000000000000000000000000000000000000000000000b0b
playerA (low addr)     0x0376AAc07Ad725E01357B1725B5ceC61aE10473c
playerB (high addr)    0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7

bondRef                0x1111111111111111111111111111111111111111111111111111111111111111
worldHash              0x2222222222222222222222222222222222222222222222222222222222222222
deadline               2000000000

domainTypeHash         0x36c25de3e541d5d970f66e4210d728721220fff5c077cc6cd008b3a0c62adab7
domainSeparator        0x99c1456df74bcdad386b8bf1d9f9223611e9e761efcf7fae74e0dd856da92d95

BondConsent typehash   0x4aeee9bd07d7616d15a49bf3f7eff3a1d844a7442dfe5575683f24aafaa7afe8
BondConsent structHash 0x0e49404530fc61f4db845e3f84604e6472ce186c6c66a909966a3b937f0622d2
BondConsent digest     0x0c9e38e1f0ded5f3e19ebf5a2d8a0efb1ff61dfef111205ce68fe54146f2279d

signature (low)        0x93a142fba36c907c39fc6370d2f296c01c442ba5b3c6e313dda713f499a2ab55
                         77768b3821d38d3ddd0002c66a5fcc4d5d28fceb626be126bb7412b0d43f546b1c
signature (high)       0xda24913c8b9e1fb0aa6d97546d73a3d080abaa87473bc3ebef8c42e5c258a4bc
                         0831a94fcfc6d3fe7e3ed1166db8910c4e80a0976f5ae50e2491bb38aa0b1d4b1c
recovered low          0x0376AAc07Ad725E01357B1725B5ceC61aE10473c   (exact)
recovered high         0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7   (exact)

createBond selector    0x10380e4d
functionSignatureHash  0x8e83d3ed46c9349a2dcb3fb8e373e10d715802066b99dfaabc6b3a1f4a215a6f
MetaTransaction typehash 0x23d10def3caacba2e4042e0c75d44a42d2558aabcf5ce951d0642a8032e1e653
nonce                  0
from                   0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7
metaStructHash         0xfb42af2b2c5ce37636ae41264e9e9a6af87cf3c11ebbc42850b0f450416ff17f
metaDigest             0xf5c08193d756e276726fb0fb4e318c5e91c8ed420c8f9689edab428d424d6ec9

executeMetaTransaction selector  0x0c53c51c
relayer calldata length          708 bytes
```

---

## Exact `eth_signTypedData_v4` request

Shaped exactly as `decentraland-transactions`' `getDataToSign` builds it — note the params
are `[account, JSON.stringify(payload)]`, a **string**, not an object.

```json
{
  "method": "eth_signTypedData_v4",
  "params": [
    "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
    "{\"types\":{\"EIP712Domain\":[{\"name\":\"name\",\"type\":\"string\"},{\"name\":\"version\",\"type\":\"string\"},{\"name\":\"verifyingContract\",\"type\":\"address\"},{\"name\":\"salt\",\"type\":\"bytes32\"}],\"MetaTransaction\":[{\"name\":\"nonce\",\"type\":\"uint256\"},{\"name\":\"from\",\"type\":\"address\"},{\"name\":\"functionSignature\",\"type\":\"bytes\"}]},\"domain\":{\"name\":\"LingerBond\",\"version\":\"1\",\"verifyingContract\":\"0xFb1b848e938aE6474F890bfb28f6a793a515BAcb\",\"salt\":\"0x0000000000000000000000000000000000000000000000000000000000013882\"},\"primaryType\":\"MetaTransaction\",\"message\":{\"nonce\":0,\"from\":\"0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7\",\"functionSignature\":\"0x10380e4d…\"}}"
  ]
}
```

ethers hashes that payload to `0xf5c08193…424d6ec9`, which is exactly what
`executeMetaTransaction` recomputes from `(nonce, from, keccak(functionSignature))` and the
contract's own `domainSeparator`. **The wallet's signing path and the Solidity verification
path produce the same digest.**

---

## Chain of custody, hop by hop

| Hop | Verified how | Status |
|---|---|---|
| Wallet builds domain from `contractData` | Field-for-field against `getDomainData` | PASS |
| Wallet hashes payload (`eth_signTypedData_v4`) | ethers `_TypedDataEncoder` reproduces the Solidity digest | PASS |
| Wallet returns 65-byte signature | `splitSignature` → r/s/v; client normalises `v` | PASS |
| Client builds `executeMetaTransaction` calldata | Selector `0x0c53c51c`, 708 bytes | PASS |
| Relay server forwards `[address, txData]` | No value field; non-payable is fine | PASS |
| Relayer will accept this contract | Whitelist — see 8.2 | **UNVERIFIED** |
| Contract verifies meta signature | `ECDSA.recover(digest, v, r, s)` — overload order confirmed `(hash,v,r,s)` | PASS |
| Contract self-calls `createBond` | `test_metaTransaction_relayedByThirdParty` | PASS |
| `createBond` verifies both consents | 14 authorization/substitution tests | PASS |

---

## Commands and outputs

```
$ forge --version
forge Version: 1.5.1-stable

$ cast sig 'getNonce(address)'
0x2d0335ab                      # client hardcodes 2d0335ab  → match

$ cast sig 'executeMetaTransaction(address,bytes,bytes32,bytes32,uint8)'
0x0c53c51c                      # client hardcodes 0c53c51c  → match

$ forge test
Ran 2 test suites: 55 tests passed, 0 failed, 0 skipped (55 total tests)

$ forge test --match-path test/MetaTxVectors.t.sol -vv
[PASS] test_vector_bondConsent()
[PASS] test_vector_domainSeparator_matchesCanonicalConstruction()
[PASS] test_vector_metaTransaction()
(full vector values reproduced above)

$ node script/crosscheck.js
LINGER — independent EIP-712 cross-check (ethers v5.8.0)
PASS  EIP712Domain typehash
PASS  BondConsent typehash
PASS  MetaTransaction typehash
PASS  domainSeparator (ethers TypedDataEncoder)
PASS  BondConsent structHash
PASS  BondConsent digest
PASS  signature (low address)
PASS  signature (high address)
PASS  recovered low  == playerA
PASS  recovered high == playerB
PASS  createBond selector
PASS  functionSignature keccak
PASS  MetaTransaction digest
PASS  executeMetaTransaction selector
ALL CHECKS PASS
```

Reproduce with:

```bash
forge test --match-path test/MetaTxVectors.t.sol -vv
node script/crosscheck.js
```

---

## AMOY_READY: **NO**

The contract itself is ready — every offline compatibility check passes, and two
independent implementations agree byte-for-byte on every digest, selector and signature.

It is **not** deploy-ready because two things outside the contract are unverified, and
deploying before settling them would mean finding out in front of an audience:

1. **`eth_signTypedData_v4` support in the Decentraland client is unproven (row 7.4, HIGH).**
   `signMessage` in `~system/EthereumController` is a flat string dict and is not EIP-712,
   so typed data must go through `sendAsync`. The SDK passes it through without filtering,
   but whether the explorer — and especially the **mobile** explorer — implements the method
   is unknown. If it does not, the whole gasless flow is unavailable and the design needs
   revisiting, not the contract.

2. **Relayer availability is unresolved (row 8.2, MEDIUM).** Decentraland's transactions
   server relays only to whitelisted contracts, and `LingerBond` cannot be on Decentraland's
   list. A self-hosted transactions-server instance or another relayer is required, plus
   funding.

Neither is a contract defect. Both are prerequisites.

**Recommended order:** prove `eth_signTypedData_v4` on a desktop client, then on mobile
(cheap, no deployment needed — sign the vector above and check the signature recovers to
the expected address). Then stand up a relayer. Then deploy to Amoy. An independent audit
should still precede mainnet.
