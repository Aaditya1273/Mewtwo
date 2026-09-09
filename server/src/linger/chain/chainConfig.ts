/**
 * Chain configuration.
 *
 * Disabled by default. When enabled, every required value must be present — a
 * half-configured chain layer fails at boot rather than at the emotional peak of a demo.
 *
 * No key material is read here or anywhere in the repository. The relayer holds its own
 * credentials; LINGER's server never sees a private key.
 */

export interface ChainConfig {
  enabled: boolean
  network: string
  rpcUrl: string
  contractAddress: string
  relayerUrl: string
  protocolVersion: number
  confirmations: number
}

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? parsed : fallback
}

export function readChainConfig(): ChainConfig {
  return {
    enabled: env('LINGER_CHAIN_ENABLED', 'false') === 'true',
    network: env('LINGER_CHAIN_NETWORK', 'polygon-amoy'),
    rpcUrl: env('LINGER_CHAIN_RPC_URL', ''),
    contractAddress: env('LINGER_BOND_CONTRACT', ''),
    relayerUrl: env('LINGER_RELAYER_URL', ''),
    protocolVersion: envInt('LINGER_CHAIN_PROTOCOL_VERSION', 1),
    confirmations: envInt('LINGER_CHAIN_CONFIRMATIONS', 3)
  }
}

/** Missing settings, or empty when the configuration is complete (or the feature is off). */
export function validateChainConfig(config: ChainConfig): string[] {
  if (!config.enabled) return []

  const missing: string[] = []
  if (!config.rpcUrl) missing.push('LINGER_CHAIN_RPC_URL')
  if (!config.contractAddress) missing.push('LINGER_BOND_CONTRACT')
  if (!config.relayerUrl) missing.push('LINGER_RELAYER_URL')
  if (config.confirmations < 1) missing.push('LINGER_CHAIN_CONFIRMATIONS (must be >= 1)')
  return missing
}
