import express, { type Request, type Response } from 'express'
import { encodeFunctionData } from 'viem'
import { logger }             from '../logger.js'
import { fetchWithTimeout }   from '../utils/fetchWithTimeout.js'
import { TestAggregatorSwapABI } from '../contracts/index.js'
import type { PaymentRequirements, PaymentPayload, PaymentRequired } from './types.js'
import { fetchLivePrice } from '../prices/coincap.js'

interface VerifyResponse {
  isValid:     boolean
  payer?:      string
  invalidReason?: string
}

interface SettleResponse {
  success:     boolean
  transaction: string
  network:     string
  payer?:      string
  errorReason?: string
}

const X402_VERSION = 2

// x402 resource server — backs the price/routing endpoints the agent pays for.
// Payment proofs are verified and settled on-chain via the public x402
// facilitator (facilitator.x402.rs), which speaks x402 protocol v2 for the
// "exact" EIP-3009 scheme on Arbitrum Sepolia ("eip155:421614").
// Prices: live from CoinCap Pro when COINCAP_KEY is set, synthetic otherwise.
// Routing: synthetic TestAggregator calldata — replace with real DEX router for mainnet.
export function startMockX402Server(
  port:           number,
  assetAddr:      string,
  payToAddr:      string,
  network:        string, // CAIP-2, e.g. "eip155:421614"
  facilitatorUrl: string,
  coincapKey?:    string,
): void {
  const app           = express()
  const FALLBACK_PRICE = 1647.0
  const serverLog      = logger.child({ component: 'x402-server' })

  function paymentRequirements(amountAtomic: string): PaymentRequirements {
    return {
      scheme:            'exact',
      network,
      amount:            amountAtomic,
      payTo:             payToAddr,
      asset:             assetAddr,
      maxTimeoutSeconds: 300,
      extra:             { assetTransferMethod: 'eip3009', name: 'USD Coin', version: '2' },
    }
  }

  function demand402(res: Response, req: Request, requirements: PaymentRequirements, description: string, error?: string): void {
    const body: PaymentRequired = {
      x402Version: X402_VERSION,
      accepts:     [requirements],
      resource:    { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`, description, mimeType: 'application/json' },
      extensions:  {},
    }
    if (error) body.error = error
    res.status(402).json(body)
  }

  function decodePayment(header: string): PaymentPayload | null {
    try {
      return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as PaymentPayload
    } catch {
      return null
    }
  }

  // Verifies and settles an x402 payment proof against the facilitator.
  // Returns the settlement tx hash on success, or null (with a 402 response
  // already sent) on failure.
  async function settlePayment(
    req: Request,
    res: Response,
    requirements: PaymentRequirements,
    description: string,
  ): Promise<string | null> {
    const header = req.headers['x-payment']
    if (!header || typeof header !== 'string') {
      demand402(res, req, requirements, description)
      return null
    }

    const paymentPayload = decodePayment(header)
    if (!paymentPayload) {
      res.status(400).json({ error: 'invalid X-Payment header — expected base64-encoded JSON' })
      return null
    }

    const body = { x402Version: X402_VERSION, paymentPayload, paymentRequirements: requirements }

    const verifyResp = await fetchWithTimeout(`${facilitatorUrl}/verify`, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify(body),
      timeoutMs: 15_000,
    })
    const verify = await verifyResp.json() as VerifyResponse

    if (!verify.isValid) {
      serverLog.warn({ reason: verify.invalidReason }, 'x402 payment verification failed')
      demand402(res, req, requirements, description, verify.invalidReason ?? 'invalid_payment')
      return null
    }

    const settleResp = await fetchWithTimeout(`${facilitatorUrl}/settle`, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify(body),
      timeoutMs: 30_000,
    })
    const settle = await settleResp.json() as SettleResponse

    if (!settle.success) {
      serverLog.warn({ reason: settle.errorReason }, 'x402 payment settlement failed')
      demand402(res, req, requirements, description, settle.errorReason ?? 'settlement_failed')
      return null
    }

    serverLog.info({ tx: settle.transaction, payer: settle.payer }, 'x402 payment settled')
    return settle.transaction
  }

  // GET /price/:token
  app.get('/price/:token', async (req: Request, res: Response) => {
    const token = req.params['token']?.toUpperCase() ?? 'ETH'

    const requirements = paymentRequirements('1000') // 0.001 USDC
    const tx = await settlePayment(req, res, requirements, `${token}/USDC price data`)
    if (!tx) return

    let priceUsd          = FALLBACK_PRICE
    let changePercent24Hr = 0

    if (coincapKey) {
      try {
        const live        = await fetchLivePrice(token, coincapKey)
        priceUsd          = live.priceUsd
        changePercent24Hr = live.changePercent24Hr
      } catch (err) {
        serverLog.warn({ err, token }, 'CoinCap fetch failed, using fallback price')
      }
    }

    res.json({
      token,
      price_usdc:           priceUsd,
      change_percent_24hr:  changePercent24Hr,
      source:               coincapKey ? 'coincap-pro' : 'mock',
      timestamp:            Math.floor(Date.now() / 1000),
      x402_tx:              tx,
    })
  })

  // GET /route?from=<addr>&to=<addr>&amount=<uint>&aggregator=<addr>
  // Returns TestAggregator.swap() calldata and expected output amounts.
  app.get('/route', async (req: Request, res: Response) => {
    const requirements = paymentRequirements('2000') // 0.002 USDC
    const tx = await settlePayment(req, res, requirements, 'DEX swap routing')
    if (!tx) return

    const { from, to, amount, aggregator } = req.query as Record<string, string | undefined>
    if (!from || !to || !amount) {
      res.status(400).json({ error: 'missing query params: from, to, amount' })
      return
    }

    let price = FALLBACK_PRICE
    if (coincapKey) {
      try {
        const live = await fetchLivePrice('ETH', coincapKey)
        price = live.priceUsd
      } catch (err) {
        serverLog.warn({ err }, `CoinCap fetch failed, using fallback price $${FALLBACK_PRICE}`)
      }
    }

    const spendAmount  = BigInt(amount)
    const outputAmount = (spendAmount * BigInt(1e18)) / BigInt(Math.round(price) * 1_000_000)
    const minOutput    = (outputAmount * 9950n) / 10_000n

    const swapData = encodeFunctionData({
      abi:          TestAggregatorSwapABI,
      functionName: 'swap',
      args: [
        from  as `0x${string}`,
        spendAmount,
        to    as `0x${string}`,
        outputAmount,
      ],
    })

    res.json({
      output_amount:     outputAmount.toString(),
      min_output_amount: minOutput.toString(),
      swap_data:         swapData,
      aggregator,
      x402_tx:           tx,
    })
  })

  app.listen(port, () => {
    serverLog.info({
      port,
      network,
      facilitatorUrl,
      priceSource: coincapKey ? 'coincap-pro' : `mock-$${FALLBACK_PRICE}`,
    }, 'x402 resource server listening')
  })
}
