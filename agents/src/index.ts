import { privateKeyToAccount } from 'viem/accounts'
import { config }              from './config.js'
import { logger }              from './logger.js'
import { startMockX402Server } from './x402/server.js'

async function main(): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)
  const chainName = config.chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'

  logger.info({ address: account.address, port: config.mockX402Port }, 'starting mock x402 server...')

  startMockX402Server(
    config.mockX402Port,
    config.usdcAddr,
    account.address,
    chainName,
    config.coincapKey,
  )

  logger.info('agents daemon running')
}

main().catch(err => {
  logger.error({ err }, 'agents daemon failed')
  process.exit(1)
})
