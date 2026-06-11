import 'dotenv/config'

// All env-var access is centralised here. The process fails fast at startup
// if any required variable is missing — never silently mid-execution.

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Required env var "${key}" is not set`)
  return v
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

const mockPort = parseInt(optionalEnv('MOCK_X402_PORT', '8402'))

export const config = {
  // Chain
  rpcUrl:  requireEnv('RPC_URL'),
  chainId: parseInt(optionalEnv('CHAIN_ID', '421614')),

  // Agent identity
  privateKey:    requireEnv('PRIVATE_KEY') as `0x${string}`,
  agentId:       BigInt(optionalEnv('AGENT_ID', '1')),
  minTrustScore: BigInt(optionalEnv('MIN_TRUST_SCORE', '50')),

  // Contracts
  subscriptionsAddr:      requireEnv('SUBSCRIPTIONS_ADDR')       as `0x${string}`,
  validationRegistryAddr: requireEnv('VALIDATION_REGISTRY_ADDR') as `0x${string}`,
  aggregatorAddr:         requireEnv('AGGREGATOR_ADDR')           as `0x${string}`,
  outputTokenAddr:        requireEnv('OUTPUT_TOKEN_ADDR')         as `0x${string}`,
  usdcAddr:               requireEnv('USDC_ADDR')                 as `0x${string}`,

  // Indexer — set INDEXER_START_BLOCK to the block just before your first subscription
  // to avoid a full chain scan. Defaults to 0 (full scan).
  indexerStartBlock: BigInt(optionalEnv('INDEXER_START_BLOCK', '0')),
  indexerPollMs:     parseInt(optionalEnv('INDEXER_POLL_SECS', '20')) * 1000,

  // x402
  mockX402Enabled: optionalEnv('MOCK_X402_ENABLED', 'true') === 'true',
  mockX402Port:    mockPort,
  x402PriceUrl:    optionalEnv('X402_PRICE_URL',   `http://localhost:${mockPort}/price`),
  x402RoutingUrl:  optionalEnv('X402_ROUTING_URL', `http://localhost:${mockPort}/route`),

  // Gas ceiling (PRD §9.1): skip execution if Arbitrum gas exceeds this value
  maxGasGwei: parseFloat(optionalEnv('MAX_GAS_GWEI', '0.1')),

  // Scheduler tick interval
  schedulerIntervalMs: parseInt(optionalEnv('SCHEDULER_INTERVAL_SECS', '30')) * 1000,

  // Optional integrations — agent runs with deterministic rules if these are absent
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] as string | undefined,
  coincapKey:      process.env['COINCAP_KEY']       as string | undefined,
} as const
