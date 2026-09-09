import { engine, executeTask } from '@dcl/sdk/ecs'
import { createEthereumProvider } from '@dcl/sdk/ethereum-provider'
// Static import: `require` does not exist in the SDK7 sandbox. The SDK's own provider
// polyfills TextEncoder specifically so ethers can run here, so this is a supported shape.
import { utils as ethersUtils } from 'ethers'
import { setResult, initUi, ProbeState } from './ui'
import {
  TYPED_DATA,
  EXPECTED_CONSENT_DIGEST,
  EXPECTED_DOMAIN_SEPARATOR,
  CHAIN_ID,
  VERIFYING_CONTRACT
} from '../vector'

export * from '@dcl/sdk'

/**
 * DECENTRALAND EIP-712 SIGNING PROBE — diagnostic only.
 *
 * Answers exactly one question: can a real Decentraland client execute
 * `eth_signTypedData_v4` for the audited LingerBond BondConsent payload, and does its
 * EIP-712 encoding agree with ours?
 *
 * IT NEVER: sends a transaction, writes to a contract, moves value, touches a token,
 * grants an approval, or contacts Polygon. It requests one signature and verifies it
 * locally. The signature is held in memory for the check and is not persisted.
 *
 * WHAT "MATCH" MEANS HERE — and this differs from the offline vector:
 *
 *   The audited vector's signer, 0xe05fcC23…0cfF7, is derived from the test constant
 *   0xa11ce that lives in this repository. Nobody controls that key, so a real wallet
 *   CANNOT and MUST NOT reproduce that signature.
 *
 *   The meaningful assertion is instead:
 *
 *       recover(ourLocallyComputedDigest, clientSignature) == connectedAccount
 *
 *   If the client hashed the payload even slightly differently — a different domain type,
 *   chainId instead of salt, a reordered field — recovery yields an unrelated address and
 *   this fails. Agreement therefore proves the client's encoder matches the contract's,
 *   which is the thing the audit could not settle offline.
 */

const EXPECTED_TEST_VECTOR_SIGNER = '0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7'

function rpc(provider: any, method: string, params: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    provider.sendAsync(
      { jsonrpc: '2.0', id: Date.now(), method, params },
      (error: any, response: any) => {
        if (error) return reject(error)
        if (response && response.error) return reject(new Error(JSON.stringify(response.error)))
        resolve(response ? response.result : undefined)
      }
    )
  })
}

export function main() {
  initUi()
  executeTask(async () => {
    await runProbe()
  })
}

async function runProbe() {
  const state: ProbeState = {
    status: 'RUNNING',
    lines: [],
    detail: ''
  }

  function log(line: string) {
    console.log('[probe] ' + line)
    state.lines.push(line)
    setResult(state)
  }

  log(`chainId ${CHAIN_ID}`)
  log(`verifyingContract ${VERIFYING_CONTRACT}`)
  log(`primaryType ${TYPED_DATA.primaryType}`)

  // ---- 0. Local self-check: has the probe drifted from the audited vector? -------
  // Recovery uses ethers. If ethers cannot run in this sandbox, or its encoder disagrees
  // with the audited digest, the probe is broken and any client result is meaningless —
  // so this runs first and refuses to continue on failure.
  let localDigest = ''
  let localDomainSeparator = ''
  try {
    localDigest = (ethersUtils as any)._TypedDataEncoder.hash(
      TYPED_DATA.domain,
      { BondConsent: TYPED_DATA.types.BondConsent },
      TYPED_DATA.message
    )
    localDomainSeparator = (ethersUtils as any)._TypedDataEncoder.hashDomain(TYPED_DATA.domain)
  } catch (error) {
    state.status = 'FAIL'
    state.detail = `ethers cannot run in this runtime: ${describe(error)}`
    log(`FAIL: ${state.detail}`)
    setResult(state)
    return
  }

  log(`local domainSeparator ${localDomainSeparator}`)
  log(`local digest ${localDigest}`)

  if (localDigest.toLowerCase() !== EXPECTED_CONSENT_DIGEST.toLowerCase()) {
    state.status = 'FAIL'
    state.detail = 'probe payload does not reproduce the audited digest'
    log('FAIL: probe drifted from the audited vector — fix the probe, not the contract')
    setResult(state)
    return
  }
  if (localDomainSeparator.toLowerCase() !== EXPECTED_DOMAIN_SEPARATOR.toLowerCase()) {
    state.status = 'FAIL'
    state.detail = 'domain separator mismatch against the audited constant'
    log('FAIL: domain separator drift')
    setResult(state)
    return
  }
  log('self-check OK: payload reproduces the audited digest')

  // ---- 1. Provider + account ------------------------------------------------------
  let provider: any
  try {
    provider = createEthereumProvider()
  } catch (error) {
    state.status = 'UNVERIFIED'
    state.detail = 'no Ethereum provider in this environment'
    log('UNVERIFIED — CLIENT CAPABILITY: no provider')
    setResult(state)
    return
  }

  let account = ''
  try {
    const accounts = await rpc(provider, 'eth_requestAccounts', [])
    account = Array.isArray(accounts) && accounts.length > 0 ? String(accounts[0]) : ''
    if (!account) {
      const fallback = await rpc(provider, 'eth_accounts', [])
      account = Array.isArray(fallback) && fallback.length > 0 ? String(fallback[0]) : ''
    }
  } catch (error) {
    log(`account lookup failed: ${describe(error)}`)
  }

  if (!account) {
    state.status = 'UNVERIFIED'
    state.detail = 'no wallet connected (guest session?)'
    log('UNVERIFIED — CLIENT CAPABILITY: no wallet account available')
    setResult(state)
    return
  }
  log(`connected account ${account}`)

  // ---- 2. Request the signature ---------------------------------------------------
  // Params are [address, JSON string] — the string form is what decentraland-transactions
  // sends, and some providers reject an object here.
  const payload = JSON.stringify(TYPED_DATA)
  let signature = ''

  try {
    signature = String(await rpc(provider, 'eth_signTypedData_v4', [account, payload]))
  } catch (error) {
    const message = describe(error)
    const looksUnsupported =
      message.indexOf('not supported') !== -1 ||
      message.indexOf('does not exist') !== -1 ||
      message.indexOf('Method not found') !== -1 ||
      message.indexOf('-32601') !== -1
    const looksRejected =
      message.indexOf('denied') !== -1 ||
      message.indexOf('rejected') !== -1 ||
      message.indexOf('User denied') !== -1

    state.status = looksUnsupported ? 'UNVERIFIED' : 'FAIL'
    state.detail = looksUnsupported
      ? 'client does not expose eth_signTypedData_v4'
      : looksRejected
        ? 'user rejected the signature request'
        : `signing failed: ${message}`
    log(
      looksUnsupported
        ? 'UNVERIFIED — CLIENT CAPABILITY: eth_signTypedData_v4 not supported'
        : `FAIL: ${state.detail}`
    )
    // Deliberately NOT falling back to signMessage. It is not EIP-712 and would prove
    // nothing about this contract.
    setResult(state)
    return
  }

  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    state.status = 'FAIL'
    state.detail = `malformed signature (${signature.length} chars)`
    log(`FAIL: ${state.detail}`)
    setResult(state)
    return
  }
  log(`signature ${signature}`)

  // ---- 3. Normalise v exactly as decentraland-transactions does -------------------
  // Ledger returns v as 0/1; the client library maps <27 to +27 and rejects anything
  // outside {27,28}. OpenZeppelin's ECDSA requires {27,28}, so this mirrors production.
  const normalised = normaliseV(signature)
  if (!normalised) {
    state.status = 'FAIL'
    state.detail = 'signature v byte outside {27,28} after normalisation'
    log(`FAIL: ${state.detail}`)
    setResult(state)
    return
  }
  if (normalised !== signature) log(`normalised v -> ${normalised.slice(-2)}`)

  // ---- 4. Recover ------------------------------------------------------------------
  let recovered = ''
  try {
    recovered = ethersUtils.recoverAddress(localDigest, normalised)
  } catch (error) {
    state.status = 'FAIL'
    state.detail = `recovery threw: ${describe(error)}`
    log(`FAIL: ${state.detail}`)
    setResult(state)
    return
  }

  log(`recovered ${recovered}`)
  log(`expected  ${account} (the connected wallet)`)
  log(`note: the audited vector's signer ${EXPECTED_TEST_VECTOR_SIGNER} is a repo test key`)

  if (recovered.toLowerCase() === account.toLowerCase()) {
    state.status = 'PASS'
    state.detail = 'client EIP-712 encoding matches the contract'
    log('PASS: the client signed our exact digest')
  } else {
    state.status = 'FAIL'
    state.detail = 'recovered signer is not the connected account — encoder mismatch'
    log('FAIL: encoder mismatch — the client hashed something other than our payload')
  }

  setResult(state)
}

/** Map v<27 up by 27, then require {27,28}. Mirrors decentraland-transactions. */
function normaliseV(signature: string): string | null {
  const body = signature.slice(0, 130)
  let v = parseInt(signature.slice(130, 132), 16)
  if (v < 27) v += 27
  if (v !== 27 && v !== 28) return null
  return '0x' + body.slice(2) + v.toString(16)
}

function describe(error: unknown): string {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  const anyError = error as any
  return String(anyError.message ?? anyError.error ?? JSON.stringify(anyError))
}
