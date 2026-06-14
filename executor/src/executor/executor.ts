import { randomUUID } from 'node:crypto'
import { encodeAbiParameters, formatUnits } from 'viem'
import { logger }                           from '../logger.js'
import { TrustScoreError, GasCeilingError, ExecutionError } from '../errors.js'
import { withRetry }                        from '../utils/retry.js'
import { SubscriptionsABI, ValidationRegistryABI } from '../contracts/index.js'
import { query }             from '../db/pool.js'
import type { Clients }     from '../chain/client.js'
import type { X402Client }  from '../x402/client.js'
import type { ClaudeAgent } from '../agent/claude.js'
import { config }           from '../config.js'

// Reflects the deployed Subscription struct (Subscriptions.sol). Timing
// fields are uint48/uint32, decoded by viem as `number`; amountPerCycle is
// uint96, decoded as `bigint`.
interface SubscriptionData {
  subscriber:            `0x${string}`
  service:               `0x${string}`
  spendToken:            `0x${string}`
  amountPerCycle:        bigint
  interval:              number
  lastExecutionTime:     number
  subscriptionStartTime: number
  permitExpiry:          number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export class Executor {
  constructor(
    private readonly clients: Clients,
    private readonly x402:    X402Client,
    private readonly claude:  ClaudeAgent | null,
  ) {}

  async tryExecute(subId: `0x${string}`): Promise<void> {
    const label = subId.slice(0, 10) + '...'
    const log   = logger.child({ subId: label })
    const { publicClient, walletClient, account } = this.clients

    // ── 1. Read subscription ─────────────────────────────────────────────────
    const sub = await withRetry(
      () => publicClient.readContract({
        address:      config.subscriptionsAddr,
        abi:          SubscriptionsABI,
        functionName: 'getSubscription',
        args:         [subId],
      }),
      { label: `readContract:getSubscription:${label}`, maxAttempts: 3 },
    ) as SubscriptionData

    if (sub.subscriber === ZERO_ADDRESS) {
      log.debug('subscription not found — skipping')
      return
    }

    const nowSecs = Math.floor(Date.now() / 1000)

    // ── 2. Timing and expiry checks ──────────────────────────────────────────
    if (sub.permitExpiry <= nowSecs) {
      log.debug({ permitExpiry: sub.permitExpiry }, 'permit expired — skipping')
      return
    }

    const nextDue   = sub.lastExecutionTime + sub.interval
    const remaining = nextDue - nowSecs
    if (nowSecs < nextDue) {
      log.debug({ remainingSecs: remaining }, 'not due yet — skipping')
      return
    }

    // ── 3. ERC-8004 trust score check ─────────────────────────────────────────
    const score = await withRetry(
      () => publicClient.readContract({
        address:      config.validationRegistryAddr,
        abi:          ValidationRegistryABI,
        functionName: 'getScore',
        args:         [config.agentId],
      }),
      { label: 'readContract:getScore', maxAttempts: 3 },
    ) as bigint

    if (score < config.minTrustScore) {
      throw new TrustScoreError(score, config.minTrustScore)
    }

    log.info({
      subscriber: sub.subscriber.slice(0, 10),
      amountUsdc: formatUnits(sub.amountPerCycle, 6),
      score: score.toString(),
    }, 'executing subscription')

    // ── 4. Gas price ceiling (PRD §9.1) ─────────────────────────────────────
    const gasPrice     = await withRetry(
      () => publicClient.getGasPrice(),
      { label: 'getGasPrice', maxAttempts: 3 },
    )
    const gasPriceGwei = Number(gasPrice) / 1e9
    log.info({ gasPriceGwei: gasPriceGwei.toFixed(6), ceilingGwei: config.maxGasGwei }, 'gas check')

    // ── 5. Fetch live price via x402 ─────────────────────────────────────────
    const priceResp = await this.x402.getPrice(config.x402PriceUrl, 'ETH')
    log.info({
      priceUsd:  priceResp.price_usdc,
      change24h: `${priceResp.change_percent_24hr >= 0 ? '+' : ''}${priceResp.change_percent_24hr.toFixed(2)}%`,
      source:    priceResp.source,
    }, 'price fetched')

    // ── 6. Claude safety check ───────────────────────────────────────────────
    let slippageBps = 50

    if (this.claude) {
      const decision = await this.claude.decide({
        token:             'ETH',
        priceUsdc:         priceResp.price_usdc,
        changePercent24Hr: priceResp.change_percent_24hr,
        amountUsdc:        formatUnits(sub.amountPerCycle, 6),
        gasPriceGwei,
      })

      log.info({
        shouldExecute: decision.should_execute,
        slippageBps:   decision.slippage_bps,
        anomaly:       decision.anomaly_detected,
        reasoning:     decision.reasoning,
      }, 'claude decision')

      if (!decision.should_execute) {
        log.warn({ reasoning: decision.reasoning }, 'execution skipped by Claude')
        return
      }
      if (decision.anomaly_detected) {
        log.warn({ reasoning: decision.reasoning }, 'anomaly detected — proceeding with caution')
      }
      slippageBps = decision.slippage_bps
    } else {
      // No Claude: enforce PRD §9.1 gas ceiling deterministically
      if (gasPriceGwei > config.maxGasGwei) {
        throw new GasCeilingError(gasPriceGwei, config.maxGasGwei)
      }
    }

    // ── 7. Fetch swap route via x402 ─────────────────────────────────────────
    const routeResp = await this.x402.getRoute(
      config.x402RoutingUrl,
      sub.spendToken,
      config.outputTokenAddr,
      config.aggregatorAddr,
      sub.amountPerCycle,
    )
    log.info({ outputAmount: routeResp.output_amount }, 'route fetched')

    // ── 8. Compute minOutputAmount from Claude's slippage ────────────────────
    const outputAmount    = BigInt(routeResp.output_amount)
    const minOutputAmount = (outputAmount * BigInt(10_000 - slippageBps)) / 10_000n

    // ── 9. ABI-encode SwapParams for SIPService ───────────────────────────────
    const params = encodeAbiParameters(
      [{ type: 'tuple', components: [
        { name: 'outputToken',     type: 'address' },
        { name: 'minOutputAmount', type: 'uint256' },
        { name: 'swapData',        type: 'bytes'   },
      ]}],
      [{ outputToken: config.outputTokenAddr, minOutputAmount, swapData: routeResp.swap_data }],
    )

    // ── 10. Broadcast execute() ───────────────────────────────────────────────
    // Do NOT wrap writeContract in withRetry — duplicate submissions would double-spend.
    let txHash: `0x${string}`
    try {
      txHash = await walletClient.writeContract({
        address:      config.subscriptionsAddr,
        abi:          SubscriptionsABI,
        functionName: 'execute',
        args:         [subId, params],
        account,
      })
    } catch (err) {
      throw new ExecutionError(subId, err)
    }

    log.info({ txHash }, 'tx submitted')

    // ── 11. Wait for confirmation ─────────────────────────────────────────────
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })

    if (receipt.status === 'reverted') {
      throw new ExecutionError(subId, new Error(`tx ${txHash} reverted in block ${receipt.blockNumber}`))
    }

    log.info({ block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() }, 'confirmed')

    // Only record to the DB once the tx is confirmed successful on-chain —
    // failed/reverted attempts are logged (see scheduler) but not persisted.
    await this.recordRun(subId, sub, txHash)
  }

  // Writes a successful execute() to the shared DB so the subscriber and
  // creator dashboards can show execution history. Looks up the internal
  // subscription/agent/user ids by the on-chain subscription id.
  private async recordRun(
    subId: `0x${string}`,
    sub: SubscriptionData,
    txHash: `0x${string}`,
  ): Promise<void> {
    const subRes = await query<{ id: string; user_id: string; agent_id: string }>(
      'SELECT id, user_id, agent_id FROM subscriptions WHERE onchain_sub_id = $1',
      [subId],
    )
    const subRow = subRes.rows[0]
    if (!subRow) {
      logger.warn({ subId: subId.slice(0, 10) }, 'recordRun: no matching subscription row')
      return
    }

    const amount = formatUnits(sub.amountPerCycle, 6)
    const link   = `https://sepolia.arbiscan.io/tx/${txHash}`

    await query(
      `INSERT INTO runs (run_id, agent_id, user_id, subscription_id, kind, amount, currency, status_message, link, success, tx_hash, ran_at)
       VALUES ($1,$2,$3,$4,'subscription',$5,'USDC',$6,$7,true,$8, now())`,
      [`run_${randomUUID()}`, subRow.agent_id, subRow.user_id, subRow.id, amount, 'Subscription executed successfully', link, txHash],
    )

    await query(
      `UPDATE subscriptions
       SET usage_count = usage_count + 1,
           last_payment_amount = $1,
           last_payment_time = now(),
           next_payment_amount = $1,
           next_payment_time = now() + ($2 || ' seconds')::interval
       WHERE id = $3`,
      [amount, sub.interval.toString(), subRow.id],
    )
  }
}
