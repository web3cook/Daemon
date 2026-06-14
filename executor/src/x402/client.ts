import { maxUint256 }       from 'viem'
import { logger }           from '../logger.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import { withRetry }        from '../utils/retry.js'
import { X402PaymentError } from '../errors.js'
import { ERC20ABI }         from '../contracts/index.js'
import type { Clients }     from '../chain/client.js'
import type { Decision }    from '../agent/claude.js'
import type { PaymentRequirements, Payment } from './types.js'

export interface PriceResponse {
  token:               string
  price_usdc:          number
  change_percent_24hr: number
  source:              string
  timestamp:           number
}

export interface RouteResponse {
  output_amount:     string
  min_output_amount: string
  swap_data:         `0x${string}`
}

export interface DecideRequest {
  token:        string
  spendToken:   `0x${string}`
  outputToken:  `0x${string}`
  spendAmount:  string // smallest units
  aggregator:   `0x${string}`
  gasPriceGwei: number
}

export interface DecideResponse {
  price:      PriceResponse
  decision:   Decision
  route:      RouteResponse
  settlement: { txHash: string }
}

// X402Client handles the 402 payment flow transparently:
//   1. Fetch URL → 402 with PaymentRequirements
//   2. Ensure on-chain USDC allowance to `payTo` (one-time approve, cached)
//   3. Retry with X-Payment header → receive data
//
// /v1/decide is settled for real on-chain via USDC.transferFrom(this wallet -> payTo),
// pulled by the agent server from the allowance granted in step 2. /price and /route
// remain mock (no real settlement).
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

  private async fetch402(url: string): Promise<unknown> {
    return withRetry(async () => {
      const resp = await fetchWithTimeout(url, { timeoutMs: 10_000 })

      if (resp.ok) return resp.json()

      if (resp.status !== 402) {
        const body = await resp.text()
        throw new Error(`x402: unexpected ${resp.status} from ${url}: ${body}`)
      }

      const req = await resp.json() as PaymentRequirements

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

      logger.debug({ url, amount: req.maxAmountRequired, description: req.description }, 'x402 payment sent')

      const retry = await fetchWithTimeout(url, {
        headers:   { 'X-Payment': JSON.stringify(payment) },
        timeoutMs: 10_000,
      })

      if (!retry.ok) {
        const body = await retry.text()
        throw new Error(`x402: payment rejected (${retry.status}): ${body}`)
      }

      return retry.json()
    }, { label: `x402:${url}`, maxAttempts: 2 })
  }

  async getPrice(baseUrl: string, token: string): Promise<PriceResponse> {
    const url = `${baseUrl.replace(/\/$/, '')}/${token.toUpperCase()}`
    return this.fetch402(url) as Promise<PriceResponse>
  }

  async getRoute(
    routingUrl: string,
    fromToken:  string,
    toToken:    string,
    aggregator: string,
    amount:     bigint,
  ): Promise<RouteResponse> {
    const url = `${routingUrl}?from=${fromToken}&to=${toToken}&amount=${amount}&aggregator=${aggregator}`
    return this.fetch402(url) as Promise<RouteResponse>
  }

  // Calls the DCA agent's paid /v1/decide endpoint. Pays via real on-chain
  // USDC.transferFrom (settled by the agent), using a standing allowance
  // approved on first use.
  async decide(decideUrl: string, body: DecideRequest): Promise<DecideResponse> {
    const requestBody = JSON.stringify(body)
    const headers     = { 'Content-Type': 'application/json' }

    const first = await fetchWithTimeout(decideUrl, { method: 'POST', headers, body: requestBody, timeoutMs: 15_000 })

    if (first.status !== 402) {
      if (!first.ok) throw new X402PaymentError(decideUrl, `unexpected ${first.status}: ${await first.text()}`)
      return first.json() as Promise<DecideResponse>
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

    logger.debug({ url: decideUrl, amount: req.maxAmountRequired, payTo: req.payTo }, 'x402 decide: payment sent')

    const retry = await fetchWithTimeout(decideUrl, {
      method:    'POST',
      headers:   { ...headers, 'X-Payment': JSON.stringify(payment) },
      body:      requestBody,
      timeoutMs: 30_000,
    })

    if (!retry.ok) throw new X402PaymentError(decideUrl, `payment rejected (${retry.status}): ${await retry.text()}`)
    return retry.json() as Promise<DecideResponse>
  }
}
