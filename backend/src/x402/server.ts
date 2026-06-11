import express, { type Request, type Response } from 'express'
import { encodeFunctionData } from 'viem'
import { logger }             from '../logger.js'
import { TestAggregatorSwapABI } from '../contracts/index.js'
import type { PaymentRequirements } from './types.js'
import { fetchLivePrice } from '../prices/coincap.js'

// Mock x402 server — speaks a minimal 402-payment protocol.
// Accepts any proof without real on-chain settlement.
// Prices: live from CoinCap Pro when COINCAP_KEY is set, synthetic otherwise.
// Routing: synthetic TestAggregator calldata — replace with real DEX router for mainnet.
export function startMockX402Server(
  port:        number,
  assetAddr:   string,
  payToAddr:   string,
  network:     string,
  coincapKey?: string,
): void {
  const app           = express()
  const FALLBACK_PRICE = 1647.0
  const serverLog      = logger.child({ component: 'x402-mock' })

  function demand402(res: Response, amount: string, description: string): void {
    const req: PaymentRequirements = {
      scheme: 'exact', network, maxAmountRequired: amount,
      asset: assetAddr, payTo: payToAddr, description,
    }
    res.status(402).json(req)
  }

  // GET /price/:token
  // Round 1 (no X-Payment): 402. Round 2 (X-Payment present): price JSON.
  app.get('/price/:token', async (req: Request, res: Response) => {
    const token = req.params['token']?.toUpperCase() ?? 'ETH'

    if (!req.headers['x-payment']) {
      demand402(res, '0.001 USDC', `${token}/USDC price data`)
      return
    }

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
    })
  })

  // GET /route?from=<addr>&to=<addr>&amount=<uint>&aggregator=<addr>
  // Returns TestAggregator.swap() calldata and expected output amounts.
  app.get('/route', async (req: Request, res: Response) => {
    if (!req.headers['x-payment']) {
      demand402(res, '0.002 USDC', 'DEX swap routing')
      return
    }

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
    })
  })

  app.listen(port, () => {
    serverLog.info({
      port,
      network,
      priceSource: coincapKey ? 'coincap-pro' : `mock-$${FALLBACK_PRICE}`,
    }, 'mock x402 server listening')
  })
}
