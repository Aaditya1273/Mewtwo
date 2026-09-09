/**
 * THE AUDITED VECTOR — do not edit by hand.
 *
 * These values are transcribed from the audited deterministic vector in
 * `script/crosscheck.js` and `test/MetaTxVectors.t.sol` at commit db5b598, and are
 * re-checked against those files by `verify.js` so the probe cannot silently drift from
 * what was audited.
 *
 * No private key appears here or anywhere in the probe.
 */

export const CHAIN_ID = 80002 // Polygon Amoy
export const VERIFYING_CONTRACT = '0xFb1b848e938aE6474F890bfb28f6a793a515BAcb'

export const BOND_REF = '0x1111111111111111111111111111111111111111111111111111111111111111'
export const WORLD_HASH = '0x2222222222222222222222222222222222222222222222222222222222222222'
export const DEADLINE = 2000000000

/** Canonically ordered participants from the audited vector (ascending address). */
export const PLAYER_A_LOW = '0x0376AAc07Ad725E01357B1725B5ceC61aE10473c'
export const PLAYER_B_HIGH = '0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7'

/** Audited constants. The probe asserts its own construction reproduces these. */
export const EXPECTED_DOMAIN_SEPARATOR =
  '0x99c1456df74bcdad386b8bf1d9f9223611e9e761efcf7fae74e0dd856da92d95'
export const EXPECTED_CONSENT_DIGEST =
  '0x0c9e38e1f0ded5f3e19ebf5a2d8a0efb1ff61dfef111205ce68fe54146f2279d'

/** salt = chainId, left-padded to 32 bytes. Decentraland puts the chain id here. */
export const SALT = '0x' + CHAIN_ID.toString(16).padStart(64, '0')

export const DOMAIN = {
  name: 'LingerBond',
  version: '1',
  verifyingContract: VERIFYING_CONTRACT,
  salt: SALT
}

export const EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' }
]

export const BOND_CONSENT_TYPE = [
  { name: 'bondRef', type: 'bytes32' },
  { name: 'playerA', type: 'address' },
  { name: 'playerB', type: 'address' },
  { name: 'worldHash', type: 'bytes32' },
  { name: 'deadline', type: 'uint256' }
]

export const MESSAGE = {
  bondRef: BOND_REF,
  playerA: PLAYER_A_LOW,
  playerB: PLAYER_B_HIGH,
  worldHash: WORLD_HASH,
  deadline: DEADLINE
}

/**
 * The exact object handed to `eth_signTypedData_v4`.
 *
 * Shape matches `decentraland-transactions`' own `getDataToSign`: EIP712Domain is included
 * in `types`, `primaryType` names the struct, and the whole thing is JSON-stringified
 * before it becomes the second RPC parameter.
 */
export const TYPED_DATA = {
  types: {
    EIP712Domain: EIP712_DOMAIN_TYPE,
    BondConsent: BOND_CONSENT_TYPE
  },
  domain: DOMAIN,
  primaryType: 'BondConsent',
  message: MESSAGE
}
