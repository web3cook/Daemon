import { randomBytes } from 'crypto'
import type { PrivateKeyAccount } from 'viem/accounts'
import { logger }           from '../logger.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import { withRetry }        from '../utils/retry.js'
import type { PaymentRequired, PaymentRequirements, PaymentPayload } from './types.js'

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

const X402_VERSION = 2

// X402Client handles the 402 payment flow:
//   1. Fetch URL → 402 with PaymentRequirements (x402 protocol v2)
//   2. Sign an EIP-3009 transferWithAuthorization for the requested USDC amount
//   3. Retry with X-Payment header (base64-encoded PaymentPayload) → receive data
//
// The signed authorization is verified and settled on-chain by the x402
// facilitator (https://facilitator.x402.rs — Arbitrum Sepolia is "eip155:421614"
// under protocol v2). The agent never submits a transaction itself, but the
// facilitator does, so the agent EOA must hold enough USDC to cover the
// authorization value.
export class X402Client {
  constructor(
    private readonly account: PrivateKeyAccount,
    private readonly network: string, // CAIP-2, e.g. "eip155:421614"
  ) {}

  private async buildPayment(req: PaymentRequirements, url: string): Promise<PaymentPayload> {
    const now         = Math.floor(Date.now() / 1000)
    const validAfter  = (now - 60).toString()
    const validBefore = (now + (req.maxTimeoutSeconds || 300)).toString()
    const nonce       = `0x${randomBytes(32).toString('hex')}` as `0x${string}`

    const chainId = parseInt(req.network.split(':')[1] ?? '0')

    const authorization = {
      from:  this.account.address,
      to:    req.payTo,
      value: req.amount,
      validAfter,
      validBefore,
      nonce,
    }

    const signature = await this.account.signTypedData({
      domain: {
        name:              req.extra.name,
        version:           req.extra.version,
        chainId,
        verifyingContract: req.asset as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        authorization.from        as `0x${string}`,
        to:          authorization.to          as `0x${string}`,
        value:       BigInt(authorization.value),
        validAfter:  BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce:       authorization.nonce,
      },
    })

    return {
      x402Version: X402_VERSION,
      accepted:    req,
      payload:     { signature, authorization },
      resource:    { url, description: req.scheme, mimeType: 'application/json' },
      extensions:  {},
    }
  }

  private async fetch402(url: string): Promise<unknown> {
    return withRetry(async () => {
      const resp = await fetchWithTimeout(url, { timeoutMs: 10_000 })

      if (resp.ok) return resp.json()

      if (resp.status !== 402) {
        const body = await resp.text()
        throw new Error(`x402: unexpected ${resp.status} from ${url}: ${body}`)
      }

      const body = await resp.json() as PaymentRequired
      const req  = body.accepts.find(a => a.network === this.network)
      if (!req) {
        throw new Error(`x402: no payment option for network "${this.network}" — got ${body.accepts.map(a => a.network).join(', ')}`)
      }

      const payment = await this.buildPayment(req, url)
      const header  = Buffer.from(JSON.stringify(payment)).toString('base64')

      logger.debug({ url, amount: req.amount }, 'x402 payment signed')

      const retry = await fetchWithTimeout(url, {
        headers:   { 'X-Payment': header },
        timeoutMs: 15_000,
      })

      if (!retry.ok) {
        const errBody = await retry.text()
        throw new Error(`x402: payment rejected (${retry.status}): ${errBody}`)
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
