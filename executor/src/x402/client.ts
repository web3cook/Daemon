import { logger }           from '../logger.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import { withRetry }        from '../utils/retry.js'
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

// X402Client handles the 402 payment flow transparently:
//   1. Fetch URL → 402 with PaymentRequirements
//   2. Build Payment proof (mock: no on-chain tx needed)
//   3. Retry with X-Payment header → receive data
export class X402Client {
  constructor(
    private readonly agentAddress: string,
    private readonly network:      string,
  ) {}

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
          from:  this.agentAddress,
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
}
