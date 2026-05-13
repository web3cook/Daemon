# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SIP is a non-custodial on-chain systematic investment plan (DCA) platform for EVM-compatible chains. Users approve a smart contract to spend a fixed token amount at regular intervals; a backend bot executes the trades via a DEX aggregator (1inch/Paraswap), depositing bought tokens directly back to the user's wallet. The bot never holds or controls funds.

The full product spec lives in `PRD.md`. Read it before making architectural decisions.

## Planned Architecture

The project has three top-level components, each in its own directory (not yet scaffolded):

```
contracts/    # Solidity — Subscriptions.sol + SIPService.sol
backend/      # Node.js or Python services (price history, simulation API, execution bot)
frontend/     # React/Next.js web app
```

### Smart Contracts (`contracts/`)

Two contracts with a defined interface between them:

- **`Subscriptions.sol`** — Generic protocol. Stores subscription state (subscriber, service, spendToken, amountPerCycle, interval, nextExecutionAt). Only the registered `executor` EOA can call `execute(subscriptionId)`. Users call `subscribe()` and `cancel()`. The contract pulls funds via ERC-20 `transferFrom` at execution time — it never holds funds at rest.

- **`SIPService.sol`** — Implements `IService`. Receives spend tokens from Subscriptions, calls the aggregator for best-price swap, sends output tokens directly to the subscriber. Maintains a token whitelist. Has a configurable fee (initially 0, max $0.01–$0.10/tx hardcoded at deploy).

- **`IService`** — Interface all services must implement: `execute(subscriber, spendToken, amount, params) returns (bool)`. New services (future use cases) plug into Subscriptions by implementing this interface.

Key invariant: funds flow `user wallet → Subscriptions (transient) → SIPService → aggregator → user wallet`. Nothing is ever custodied.

### Backend (`backend/`)

Three services:

- **Price History Service** — Ingests OHLCV data from an external price API (CoinGecko/CoinMarketCap), stores in PostgreSQL (TimescaleDB), exposes an internal REST API used only by the Simulation API.

- **Simulation API** — Stateless service. Given token + amount + interval + date range, replays historical DCA using price data, returns time-series portfolio data and a lump-sum comparison. Used by the frontend calculator (no wallet required).

- **Execution Bot** — Indexes `SubscriptionCreated`/`SubscriptionCancelled`/`Executed` events from the Subscriptions contract. Maintains a schedule in its own DB. At each due time: fetches aggregator swap calldata, estimates gas, submits `execute()` signed by the bot's EOA. Retries on transient failures; skips if gas exceeds a configured ceiling. Bot key stored in secrets manager — never in env files or code.

### Frontend (`frontend/`)

Four main pages:

- **Landing** — Wallet-free intro, link to simulation.
- **Simulation Calculator** — Token/amount/interval/date inputs → portfolio chart + P&L vs lump sum. No wallet required. "Start this SIP" CTA pre-fills the create form.
- **Dashboard** — Active SIPs with next-execution countdown, execution history, aggregate P&L. Requires wallet.
- **Create SIP** — Multi-step flow: pick token → set amount + interval → approve ERC-20 allowance (wallet tx) → call `subscribe()` (wallet tx).

Wallet support: MetaMask, WalletConnect, Coinbase Wallet.

## Open Decisions (from PRD §12)

Before scaffolding, confirm:
1. Launch chain (Base vs. Ethereum mainnet)
2. Aggregator (1inch vs. Paraswap vs. both)
3. Initial token whitelist and supported spend tokens
4. Default + configurable slippage tolerance
