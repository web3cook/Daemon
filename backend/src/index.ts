import { config }              from './config.js'
import { logger }              from './logger.js'
import { AppError }            from './errors.js'
import { buildClients }        from './chain/client.js'
import { startMockX402Server } from './x402/server.js'
import { X402Client }          from './x402/client.js'
import { ClaudeAgent }         from './agent/claude.js'
import { Indexer }             from './indexer/indexer.js'
import { Executor }            from './executor/executor.js'
import { Scheduler }           from './scheduler/scheduler.js'

// ── Global error handlers ──────────────────────────────────────────────────
// Operational errors propagate up and are handled at their call site.
// Anything that reaches here is a programmer error — log and exit cleanly.
process.on('uncaughtException', (err: unknown) => {
  logger.fatal({ err }, 'uncaught exception — exiting')
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'unhandled promise rejection — exiting')
  process.exit(1)
})

async function main(): Promise<void> {
  const chain = config.chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'

  // ── Chain clients ──────────────────────────────────────────────────────────
  const clients = buildClients(config.rpcUrl, config.chainId, config.privateKey)
  logger.info({ chainId: config.chainId, address: clients.account.address }, 'chain connected')

  // ── Mock x402 server ───────────────────────────────────────────────────────
  if (config.mockX402Enabled) {
    startMockX402Server(
      config.mockX402Port,
      config.usdcAddr,
      clients.account.address,
      chain,
      config.coincapKey,
    )
  }

  // ── x402 + Claude ──────────────────────────────────────────────────────────
  const x402Client = new X402Client(clients.account.address, chain)
  const claude     = config.anthropicApiKey ? new ClaudeAgent(config.anthropicApiKey) : null
  logger.info({ claudeEnabled: claude !== null }, 'safety oracle initialised')

  // ── Indexer ────────────────────────────────────────────────────────────────
  const indexer = new Indexer(
    clients.publicClient,
    config.subscriptionsAddr,
    config.indexerStartBlock,
    config.indexerPollMs,
  )
  await indexer.start()

  // ── Executor + Scheduler ───────────────────────────────────────────────────
  const executor  = new Executor(clients, x402Client, claude)
  const scheduler = new Scheduler(executor, indexer, config.schedulerIntervalMs)
  scheduler.start()

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutdown signal received')
    scheduler.stop()
    indexer.stop()
    process.exit(0)
  }
  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  // Only reached if main() itself throws synchronously before the loop starts
  const isAppErr = err instanceof AppError
  logger.fatal({ err, code: isAppErr ? err.code : undefined }, 'agent startup failed')
  process.exit(1)
})
