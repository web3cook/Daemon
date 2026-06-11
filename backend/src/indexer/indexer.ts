import { parseAbiItem, type Address, type PublicClient } from 'viem'
import { logger }    from '../logger.js'
import { withRetry } from '../utils/retry.js'

// Matches the deployed Subscriptions.sol event (uint256 amountPerCycle, uint256 interval) —
// the on-chain contract predates the packed-struct refactor; topic0 is signature-derived
// so it must match the deployed event exactly regardless of getSubscription's ABI types.
const EV_CREATED = parseAbiItem(
  'event SubscriptionCreated(bytes32 indexed id, address indexed subscriber, address indexed service, address spendToken, uint256 amountPerCycle, uint256 interval, uint48 permitExpiry)'
)
const EV_CANCELLED = parseAbiItem(
  'event SubscriptionCancelled(bytes32 indexed id, address indexed subscriber)'
)

// Arbitrum Sepolia RPC allows up to ~10k blocks per getLogs call
const CHUNK = 10_000n

interface SubEntry {
  id:           `0x${string}`
  subscriber:   Address
  permitExpiry: bigint
}

// Indexer discovers subscriptions by scanning SubscriptionCreated / SubscriptionCancelled
// events from the chain. It maintains a live in-memory map — no DB required.
// Call start() once; getActive() is safe to call at any time from the scheduler.
export class Indexer {
  private readonly subs = new Map<string, SubEntry>()
  private lastBlock: bigint
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly client:       PublicClient,
    private readonly contractAddr: Address,
    startBlock: bigint,
    private readonly pollMs: number = 20_000,
  ) {
    this.lastBlock = startBlock > 0n ? startBlock - 1n : 0n
  }

  async start(): Promise<void> {
    logger.info({ fromBlock: this.lastBlock + 1n, contract: this.contractAddr }, 'indexer starting scan')
    await this.sync()
    logger.info({ activeCount: this.getActive().length }, 'indexer initial sync complete')

    this.timer = setInterval(() => {
      this.sync().catch((err: unknown) => logger.error({ err }, 'indexer poll error'))
    }, this.pollMs)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
  }

  // Returns IDs of subscriptions whose permitExpiry is still in the future.
  getActive(): `0x${string}`[] {
    const now = BigInt(Math.floor(Date.now() / 1000))
    return [...this.subs.values()]
      .filter(s => s.permitExpiry > now)
      .map(s => s.id)
  }

  private async sync(): Promise<void> {
    const latest = await withRetry(
      () => this.client.getBlockNumber(),
      { label: 'indexer:getBlockNumber', maxAttempts: 3 },
    )

    if (this.lastBlock >= latest) return

    const from = this.lastBlock + 1n
    const to   = latest
    let newCount = 0
    let delCount = 0

    for (let chunk = from; chunk <= to; chunk += CHUNK) {
      const end = chunk + CHUNK - 1n < to ? chunk + CHUNK - 1n : to

      const [created, cancelled] = await withRetry(
        () => Promise.all([
          this.client.getLogs({ address: this.contractAddr, event: EV_CREATED,   fromBlock: chunk, toBlock: end }),
          this.client.getLogs({ address: this.contractAddr, event: EV_CANCELLED, fromBlock: chunk, toBlock: end }),
        ]),
        { label: `indexer:getLogs:${chunk}-${end}`, maxAttempts: 3 },
      )

      for (const log of created) {
        const { id, subscriber, permitExpiry } = log.args
        if (!id || !subscriber || permitExpiry === undefined) continue
        this.subs.set(id, { id, subscriber, permitExpiry: BigInt(permitExpiry) })
        logger.info({
          subId:      id.slice(0, 10),
          subscriber: subscriber.slice(0, 10),
          expires:    new Date(Number(permitExpiry) * 1000).toISOString(),
        }, 'subscription discovered')
        newCount++
      }

      for (const log of cancelled) {
        const { id } = log.args
        if (!id) continue
        if (this.subs.delete(id)) {
          logger.info({ subId: id.slice(0, 10) }, 'subscription cancelled')
          delCount++
        }
      }
    }

    if (newCount > 0 || delCount > 0) {
      logger.info({ from, to, added: newCount, removed: delCount, active: this.getActive().length }, 'indexer synced')
    }

    this.lastBlock = to
  }
}
