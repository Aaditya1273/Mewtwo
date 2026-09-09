#!/usr/bin/env node
/**
 * Probe verifier — two jobs.
 *
 * 1. SELF-TEST (no arguments)
 *    Proves the probe is correct before anyone runs it against a real client:
 *      - the probe's vector still matches the audited source of truth
 *      - the typed data hashes to the audited digest
 *      - the sign -> normalise-v -> recover path used by the probe is sound,
 *        exercised end to end against a locally generated throwaway key
 *
 *    If this fails, the probe is broken and any client result would be meaningless.
 *
 * 2. CHECK A REAL RESULT
 *      node verify.js --account 0x... --signature 0x...
 *    Recovers the signer from the audited digest and compares. This is what turns a
 *    desktop or mobile run into a recorded matrix row.
 *
 * Never prints or stores a private key. The self-test key is generated per run and
 * discarded.
 */

const path = require('path')
const fs = require('fs')
const ethers = require('ethers')

// ---- The audited source of truth -------------------------------------------------
const REPO = path.join(__dirname, '..', '..')
const CROSSCHECK = path.join(REPO, 'script', 'crosscheck.js')
const FOUNDRY_VECTOR = path.join(REPO, 'test', 'MetaTxVectors.t.sol')

const AUDITED = {
  chainId: 80002,
  verifyingContract: '0xFb1b848e938aE6474F890bfb28f6a793a515BAcb',
  bondRef: '0x1111111111111111111111111111111111111111111111111111111111111111',
  worldHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
  deadline: 2000000000,
  playerA: '0x0376AAc07Ad725E01357B1725B5ceC61aE10473c',
  playerB: '0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7',
  domainSeparator: '0x99c1456df74bcdad386b8bf1d9f9223611e9e761efcf7fae74e0dd856da92d95',
  consentDigest: '0x0c9e38e1f0ded5f3e19ebf5a2d8a0efb1ff61dfef111205ce68fe54146f2279d'
}

const DOMAIN = {
  name: 'LingerBond',
  version: '1',
  verifyingContract: AUDITED.verifyingContract,
  salt: '0x' + AUDITED.chainId.toString(16).padStart(64, '0')
}

const TYPES = {
  BondConsent: [
    { name: 'bondRef', type: 'bytes32' },
    { name: 'playerA', type: 'address' },
    { name: 'playerB', type: 'address' },
    { name: 'worldHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' }
  ]
}

const MESSAGE = {
  bondRef: AUDITED.bondRef,
  playerA: AUDITED.playerA,
  playerB: AUDITED.playerB,
  worldHash: AUDITED.worldHash,
  deadline: AUDITED.deadline
}

let failures = 0
function check(label, actual, expected) {
  const ok = String(actual).toLowerCase() === String(expected).toLowerCase()
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`        expected: ${expected}`)
    console.log(`        actual  : ${actual}`)
  }
  return ok
}

/** The probe's v-normalisation, mirroring decentraland-transactions. */
function normaliseV(signature) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null
  const body = signature.slice(2, 130)
  let v = parseInt(signature.slice(130, 132), 16)
  if (v < 27) v += 27
  if (v !== 27 && v !== 28) return null
  return '0x' + body + v.toString(16)
}

function readProbeVector() {
  const source = fs.readFileSync(path.join(__dirname, 'vector.ts'), 'utf8')
  const grab = (name) => {
    // Values may sit on the following line (prettier wraps long constants), so allow
    // whitespace including a newline after the '='.
    const m = source.match(new RegExp(`export const ${name} =\\s*['"]?([^'"\\n]+)['"]?`))
    return m ? m[1].trim() : null
  }
  return {
    chainId: Number(grab('CHAIN_ID').split(' ')[0]),
    verifyingContract: grab('VERIFYING_CONTRACT'),
    bondRef: grab('BOND_REF'),
    worldHash: grab('WORLD_HASH'),
    deadline: Number(grab('DEADLINE')),
    playerA: grab('PLAYER_A_LOW'),
    playerB: grab('PLAYER_B_HIGH'),
    domainSeparator: grab('EXPECTED_DOMAIN_SEPARATOR'),
    consentDigest: grab('EXPECTED_CONSENT_DIGEST')
  }
}

async function selfTest() {
  console.log('LINGER EIP-712 probe — self-test\n')
  console.log(`ethers ${ethers.version}\n`)

  // 1. The probe's vector must match the audited constants.
  console.log('--- probe vector vs audited constants ---')
  const probe = readProbeVector()
  for (const key of Object.keys(AUDITED)) {
    check(`vector.${key}`, probe[key], AUDITED[key])
  }

  // 2. The audited digest must still appear in the audited sources (drift guard).
  console.log('\n--- audited constants still present in source of truth ---')
  const crosscheck = fs.readFileSync(CROSSCHECK, 'utf8')
  const foundry = fs.readFileSync(FOUNDRY_VECTOR, 'utf8')
  check(
    'consentDigest present in script/crosscheck.js',
    crosscheck.includes(AUDITED.consentDigest),
    true
  )
  check(
    'bondRef present in test/MetaTxVectors.t.sol',
    foundry.includes(AUDITED.bondRef.slice(2)),
    true
  )

  // 3. The typed data must hash to the audited digest.
  console.log('\n--- payload hashing ---')
  check(
    'domainSeparator',
    ethers.utils._TypedDataEncoder.hashDomain(DOMAIN),
    AUDITED.domainSeparator
  )
  const digest = ethers.utils._TypedDataEncoder.hash(DOMAIN, TYPES, MESSAGE)
  check('BondConsent digest', digest, AUDITED.consentDigest)

  // 4. The probe's sign -> normalise -> recover path, end to end.
  //    Throwaway key, generated now, never printed, never stored.
  console.log('\n--- probe verification path (throwaway key) ---')
  const throwaway = ethers.Wallet.createRandom()
  const signature = await throwaway._signTypedData(DOMAIN, TYPES, MESSAGE)
  check('signature is 65 bytes', /^0x[0-9a-fA-F]{130}$/.test(signature), true)

  const normalised = normaliseV(signature)
  check('v normalises into {27,28}', normalised !== null, true)
  check(
    'recover(auditedDigest, signature) == signer',
    ethers.utils.recoverAddress(digest, normalised),
    throwaway.address
  )

  // 5. A wrong-payload signature must NOT recover to the signer — proves the check bites.
  const wrongMessage = { ...MESSAGE, deadline: MESSAGE.deadline + 1 }
  const wrongSig = await throwaway._signTypedData(DOMAIN, TYPES, wrongMessage)
  const wrongRecovered = ethers.utils.recoverAddress(digest, normaliseV(wrongSig))
  check(
    'a signature over different data does NOT recover to the signer',
    wrongRecovered.toLowerCase() !== throwaway.address.toLowerCase(),
    true
  )

  console.log(
    `\n${failures === 0 ? 'SELF-TEST PASS — the probe is sound' : failures + ' SELF-TEST FAILURE(S)'}`
  )
  return failures === 0
}

function checkRealResult(account, signature) {
  console.log('LINGER EIP-712 probe — real client result\n')
  console.log(`account   ${account}`)
  console.log(`signature ${signature}\n`)

  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) {
    console.log('FAIL  account is not a 20-byte address')
    return false
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    console.log(`FAIL  malformed signature (${signature.length} chars, expected 132)`)
    return false
  }

  const normalised = normaliseV(signature)
  if (!normalised) {
    console.log('FAIL  v byte outside {27,28} after normalisation')
    return false
  }
  if (normalised !== signature.toLowerCase()) console.log(`note  v normalised to ${normalised.slice(-2)}`)

  const digest = ethers.utils._TypedDataEncoder.hash(DOMAIN, TYPES, MESSAGE)
  let recovered
  try {
    recovered = ethers.utils.recoverAddress(digest, normalised)
  } catch (error) {
    console.log(`FAIL  recovery threw: ${error.message}`)
    return false
  }

  console.log(`digest    ${digest}`)
  console.log(`recovered ${recovered}`)
  const ok = recovered.toLowerCase() === account.toLowerCase()
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  recovered ${ok ? '==' : '!='} connected account`)
  if (!ok) {
    console.log('      The client hashed something other than our payload.')
    console.log('      This is an encoder mismatch, not a contract defect.')
  }
  return ok
}

const args = process.argv.slice(2)
const accountArg = args.indexOf('--account')
const signatureArg = args.indexOf('--signature')

if (accountArg !== -1 && signatureArg !== -1) {
  process.exit(checkRealResult(args[accountArg + 1], args[signatureArg + 1]) ? 0 : 1)
} else {
  selfTest().then((ok) => process.exit(ok ? 0 : 1))
}
