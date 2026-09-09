#!/usr/bin/env node
/**
 * Independent cross-check of the LingerBond EIP-712 digests.
 *
 * Recomputes both digests with ethers v5 — the same TypedDataEncoder a wallet uses to
 * service `eth_signTypedData_v4` — and compares them against the values the Solidity
 * contract produced in `test/MetaTxVectors.t.sol`.
 *
 * Two independent implementations agreeing is the evidence. Matching typestrings by eye
 * is not.
 *
 * Also prints the exact JSON-RPC payload a Decentraland client would send, so it can be
 * compared field by field against `decentraland-transactions`' own `getDataToSign`.
 *
 * PRIVATE KEYS BELOW ARE TEST-ONLY. They hold nothing and control nothing.
 *
 * Usage:  node script/crosscheck.js
 */

const path = require('path')

// ethers v5 is already present in server/node_modules (inherited from the donor project).
const ethers = require(path.join(__dirname, '..', 'server', 'node_modules', 'ethers'))

// --- Inputs: identical to test/MetaTxVectors.t.sol -------------------------------
const CHAIN_ID = 80002 // Polygon Amoy
const VERIFYING_CONTRACT = '0xFb1b848e938aE6474F890bfb28f6a793a515BAcb'
const BOND_REF = '0x1111111111111111111111111111111111111111111111111111111111111111'
const WORLD_HASH = '0x2222222222222222222222222222222222222222222222222222222222222222'
const DEADLINE = 2000000000

const PK_A = '0x' + (0xa11ce).toString(16).padStart(64, '0')
const PK_B = '0x' + (0xb0b).toString(16).padStart(64, '0')

// --- Expected values, copied from the Solidity run -------------------------------
const EXPECTED = {
  domainSeparator: '0x99c1456df74bcdad386b8bf1d9f9223611e9e761efcf7fae74e0dd856da92d95',
  consentTypeHash: '0x4aeee9bd07d7616d15a49bf3f7eff3a1d844a7442dfe5575683f24aafaa7afe8',
  metaTypeHash: '0x23d10def3caacba2e4042e0c75d44a42d2558aabcf5ce951d0642a8032e1e653',
  domainTypeHash: '0x36c25de3e541d5d970f66e4210d728721220fff5c077cc6cd008b3a0c62adab7',
  structHash: '0x0e49404530fc61f4db845e3f84604e6472ce186c6c66a909966a3b937f0622d2',
  consentDigest: '0x0c9e38e1f0ded5f3e19ebf5a2d8a0efb1ff61dfef111205ce68fe54146f2279d',
  signatureLow:
    '0x93a142fba36c907c39fc6370d2f296c01c442ba5b3c6e313dda713f499a2ab5577768b3821d38d3ddd0002c66a5fcc4d5d28fceb626be126bb7412b0d43f546b1c',
  signatureHigh:
    '0xda24913c8b9e1fb0aa6d97546d73a3d080abaa87473bc3ebef8c42e5c258a4bc0831a94fcfc6d3fe7e3ed1166db8910c4e80a0976f5ae50e2491bb38aa0b1d4b1c',
  metaDigest: '0xf5c08193d756e276726fb0fb4e318c5e91c8ed420c8f9689edab428d424d6ec9',
  functionSignatureHash: '0x8e83d3ed46c9349a2dcb3fb8e373e10d715802066b99dfaabc6b3a1f4a215a6f'
}

const { keccak256, toUtf8Bytes, defaultAbiCoder, _TypedDataEncoder, getAddress } = ethers.utils

let failures = 0
function check(label, actual, expected) {
  const ok = String(actual).toLowerCase() === String(expected).toLowerCase()
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`        solidity: ${expected}`)
    console.log(`        ethers  : ${actual}`)
  }
}

// --- The EIP-712 domain, in Decentraland's shape ---------------------------------
// Note `salt`, not `chainId`. ethers keys the domain type off which fields are present,
// so supplying salt (and omitting chainId) reproduces Decentraland's DOMAIN_TYPE exactly.
const domain = {
  name: 'LingerBond',
  version: '1',
  verifyingContract: VERIFYING_CONTRACT,
  salt: ethers.utils.hexZeroPad(ethers.BigNumber.from(CHAIN_ID).toHexString(), 32)
}

const walletA = new ethers.Wallet(PK_A)
const walletB = new ethers.Wallet(PK_B)
const [low, high] =
  walletA.address.toLowerCase() < walletB.address.toLowerCase()
    ? [walletA, walletB]
    : [walletB, walletA]

console.log('LINGER — independent EIP-712 cross-check (ethers v' + ethers.version + ')\n')
console.log(`chainId            ${CHAIN_ID}`)
console.log(`verifyingContract  ${VERIFYING_CONTRACT}`)
console.log(`playerA (low)      ${low.address}`)
console.log(`playerB (high)     ${high.address}`)
console.log(`salt               ${domain.salt}\n`)

// --- 1. Type hashes ---------------------------------------------------------------
check(
  'EIP712Domain typehash',
  keccak256(
    toUtf8Bytes('EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)')
  ),
  EXPECTED.domainTypeHash
)
check(
  'BondConsent typehash',
  keccak256(
    toUtf8Bytes(
      'BondConsent(bytes32 bondRef,address playerA,address playerB,bytes32 worldHash,uint256 deadline)'
    )
  ),
  EXPECTED.consentTypeHash
)
check(
  'MetaTransaction typehash',
  keccak256(toUtf8Bytes('MetaTransaction(uint256 nonce,address from,bytes functionSignature)')),
  EXPECTED.metaTypeHash
)

// --- 2. Domain separator ----------------------------------------------------------
check('domainSeparator (ethers TypedDataEncoder)', _TypedDataEncoder.hashDomain(domain), EXPECTED.domainSeparator)

// --- 3. BondConsent struct hash and digest ----------------------------------------
const consentTypes = {
  BondConsent: [
    { name: 'bondRef', type: 'bytes32' },
    { name: 'playerA', type: 'address' },
    { name: 'playerB', type: 'address' },
    { name: 'worldHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' }
  ]
}
const consentValue = {
  bondRef: BOND_REF,
  playerA: getAddress(low.address),
  playerB: getAddress(high.address),
  worldHash: WORLD_HASH,
  deadline: DEADLINE
}

check(
  'BondConsent structHash',
  _TypedDataEncoder.from(consentTypes).hash(consentValue),
  EXPECTED.structHash
)
check('BondConsent digest', _TypedDataEncoder.hash(domain, consentTypes, consentValue), EXPECTED.consentDigest)

// --- 4. Signatures ----------------------------------------------------------------
;(async () => {
  const sigLow = await low._signTypedData(domain, consentTypes, consentValue)
  const sigHigh = await high._signTypedData(domain, consentTypes, consentValue)

  check('signature (low address)', sigLow, EXPECTED.signatureLow)
  check('signature (high address)', sigHigh, EXPECTED.signatureHigh)

  // --- 5. Recovery ----------------------------------------------------------------
  const recoveredLow = ethers.utils.verifyTypedData(domain, consentTypes, consentValue, sigLow)
  const recoveredHigh = ethers.utils.verifyTypedData(domain, consentTypes, consentValue, sigHigh)
  check('recovered low  == playerA', recoveredLow, low.address)
  check('recovered high == playerB', recoveredHigh, high.address)

  // --- 6. MetaTransaction over the createBond calldata ----------------------------
  const iface = new ethers.utils.Interface([
    'function createBond(bytes32 bondRef,address playerA,address playerB,bytes32 worldHash,uint256 deadline,bytes consentA,bytes consentB)'
  ])
  const functionSignature = iface.encodeFunctionData('createBond', [
    BOND_REF,
    low.address,
    high.address,
    WORLD_HASH,
    DEADLINE,
    sigLow,
    sigHigh
  ])

  check('createBond selector', functionSignature.slice(0, 10), '0x10380e4d')
  check('functionSignature keccak', keccak256(functionSignature), EXPECTED.functionSignatureHash)

  const metaTypes = {
    MetaTransaction: [
      { name: 'nonce', type: 'uint256' },
      { name: 'from', type: 'address' },
      { name: 'functionSignature', type: 'bytes' }
    ]
  }
  const metaValue = { nonce: 0, from: getAddress(walletA.address), functionSignature }

  check('MetaTransaction digest', _TypedDataEncoder.hash(domain, metaTypes, metaValue), EXPECTED.metaDigest)

  // --- 7. The exact eth_signTypedData_v4 payload ----------------------------------
  // Shaped exactly as decentraland-transactions' getDataToSign builds it: EIP712Domain
  // included in `types`, primaryType MetaTransaction, and the whole thing JSON-stringified.
  const rpcPayload = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' }
      ],
      MetaTransaction: metaTypes.MetaTransaction
    },
    domain,
    primaryType: 'MetaTransaction',
    message: { nonce: 0, from: walletA.address, functionSignature }
  }

  console.log('\n--- eth_signTypedData_v4 request ---')
  console.log(
    JSON.stringify(
      { method: 'eth_signTypedData_v4', params: [walletA.address, JSON.stringify(rpcPayload)] },
      null,
      2
    ).slice(0, 1400) + '\n  ...(functionSignature truncated for display)'
  )

  console.log('\n--- relayer calldata ---')
  const executeIface = new ethers.utils.Interface([
    'function executeMetaTransaction(address userAddress,bytes functionSignature,bytes32 sigR,bytes32 sigS,uint8 sigV)'
  ])
  const metaSig = await walletA._signTypedData(domain, metaTypes, metaValue)
  const split = ethers.utils.splitSignature(metaSig)
  const calldata = executeIface.encodeFunctionData('executeMetaTransaction', [
    walletA.address,
    functionSignature,
    split.r,
    split.s,
    split.v
  ])
  check('executeMetaTransaction selector', calldata.slice(0, 10), '0x0c53c51c')
  console.log(`calldata length    ${(calldata.length - 2) / 2} bytes`)

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK(S) FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
})()
