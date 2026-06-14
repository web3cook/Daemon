import { config }              from './config.js'
import { logger }              from './logger.js'
import { AppError }            from './errors.js'
import { buildClients }        from './chain/client.js'
import { X402Client }          from './x402/client.js'
import { ClaudeAgent }         from './agent/claude.js'
import { Executor }            from './executor/executor.js'
import { Scheduler }           from './scheduler/scheduler.js'

// ── Global error handlers ──────────────────────────────────────────────────
process.on('uncaughtException', (err: unknown) => {
  logger.fatal({ err }, 'uncaught exception — exiting')
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'unhandled promise rejection — exiting')
  process.exit(1)
})

async function main(): Promise<void> {
  const chainName = config.chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'

  // ── Chain clients ──────────────────────────────────────────────────────────
  const clients = buildClients(config.rpcUrl, config.chainId, config.privateKey)
  logger.info({ chainId: config.chainId, address: clients.account.address }, 'chain connected')

  // ── x402 + Claude ──────────────────────────────────────────────────────────
  const x402Client = new X402Client(clients.account.address, chainName)
  const claude     = config.anthropicApiKey ? new ClaudeAgent(config.anthropicApiKey) : null
  logger.info({ claudeEnabled: claude !== null }, 'safety oracle initialised')

  // ── Executor + Scheduler ───────────────────────────────────────────────────
  const executor  = new Executor(clients, x402Client, claude)
  const scheduler = new Scheduler(executor, config.schedulerIntervalMs)
  scheduler.start()

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutdown signal received')
    scheduler.stop()
    process.exit(0)
  }
  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  const isAppErr = err instanceof AppError
  logger.fatal({ err, code: isAppErr ? err.code : undefined }, 'executor startup failed')
  process.exit(1)
})
