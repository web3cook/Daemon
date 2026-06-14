import { maxUint256 }       from 'viem'
import { logger }           from '../logger.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import { withRetry }        from '../utils/retry.js'
import { ERC20ABI }         from '../contracts/index.js'
import type { Clients }     from '../chain/client.js'
import type { PaymentRequirements, Payment } from './types.js'

// X402Client pays for a one-time agent's paid endpoint on behalf of the
// platform wallet. Handles the 402 payment flow:
//   1. POST url → 402 with PaymentRequirements
//   2. Ensure on-chain USDC allowance to `payTo` (one-time approve, cached)
//   3. Retry POST with X-Payment header → receive JSON result
//
// Settlement is real on-chain USDC: the agent pulls its fee via
// USDC.transferFrom(platform wallet -> payTo) from the allowance approved here.
export class X402Client {
  private readonly approvedPayTos = new Set<string>()

  constructor(
    private readonly clients:  Clients,
    private readonly usdcAddr: `0x${string}`,
  ) {}

  private async ensureAllowance(payTo: `0x${string}`, required: bigint): Promise<void> {
    const key = payTo.toLowerCase()
    if (this.approvedPayTos.has(key)) return

    const allowance = await this.clients.publicClient.readContract({
      address:      this.usdcAddr,
      abi:          ERC20ABI,
      functionName: 'allowance',
      args:         [this.clients.account.address, payTo],
    }) as bigint

    if (allowance >= required) {
      this.approvedPayTos.add(key)
      return
    }

    logger.info({ payTo, allowance: allowance.toString() }, 'x402: approving USDC allowance for agent payment')

    const txHash = await this.clients.walletClient.writeContract({
      address:      this.usdcAddr,
      abi:          ERC20ABI,
      functionName: 'approve',
      args:         [payTo, maxUint256],
      account:      this.clients.account,
      chain:        this.clients.chain,
    })
    await this.clients.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })

    this.approvedPayTos.add(key)
  }

  // Calls a one-time agent's paid POST endpoint (convention: /v1/invoke). Pays
  // via real on-chain USDC.transferFrom (settled by the agent), using a
  // standing allowance approved on first use.
  async invoke<T = unknown>(url: string, body: unknown): Promise<T> {
    return withRetry(async () => {
      const requestBody = JSON.stringify(body)
      const headers     = { 'Content-Type': 'application/json' }

      const first = await fetchWithTimeout(url, { method: 'POST', headers, body: requestBody, timeoutMs: 15_000 })

      if (first.status !== 402) {
        if (!first.ok) throw new Error(`x402 invoke: unexpected ${first.status} from ${url}: ${await first.text()}`)
        return first.json() as Promise<T>
      }

      const req = await first.json() as PaymentRequirements
      await this.ensureAllowance(req.payTo as `0x${string}`, BigInt(req.maxAmountRequired))

      const payment: Payment = {
        scheme:  req.scheme,
        network: req.network,
        asset:   req.asset,
        payload: {
          from:  this.clients.account.address,
          value: req.maxAmountRequired,
          nonce: Date.now().toString(),
        },
      }

      logger.debug({ url, amount: req.maxAmountRequired, payTo: req.payTo }, 'x402 invoke: payment sent')

      const retry = await fetchWithTimeout(url, {
        method:    'POST',
        headers:   { ...headers, 'X-Payment': JSON.stringify(payment) },
        body:      requestBody,
        timeoutMs: 30_000,
      })

      if (!retry.ok) throw new Error(`x402 invoke: payment rejected (${retry.status}): ${await retry.text()}`)
      return retry.json() as Promise<T>
    }, { label: `x402:invoke:${url}`, maxAttempts: 2 })
  }
}
