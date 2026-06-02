# Product Requirements Document: SIP — Systematic Investment Plan for Crypto

**Version:** 1.0  
**Date:** 2026-05-13  
**Status:** Draft

---

## 1. Overview

SIP is a non-custodial, on-chain systematic investment plan platform for crypto assets. Users define a recurring investment (token, amount, interval) and sign a one-time on-chain approval. A backend bot then executes purchases at the defined intervals using a price aggregator, depositing bought assets directly into the user's wallet. The user retains full custody at all times — the bot can only execute within the exact parameters the user approved and can never move funds to any other destination.

The underlying architecture is generic: it is built around two contract primitives — **Subscriptions** and **Services** — which together form a reusable protocol that any recurring on-chain action can be built on, not just token purchases.

---

## 2. Problem Statement

Dollar-cost averaging (DCA) is one of the most well-studied strategies for reducing timing risk when investing in volatile assets. In traditional finance it is trivially available through brokers. In crypto it requires either:

- Trusting a centralized exchange to hold your funds and execute on your behalf, or
- Manually executing trades at regular intervals, which most people don't maintain.

There is no simple, non-custodial, on-chain way for a retail user to set up a recurring investment plan and walk away, knowing their funds are safe and the plan is executing automatically.

---

## 3. Goals

- Allow any user with an EVM-compatible wallet to set up a recurring crypto investment plan in under 5 minutes.
- Remain fully non-custodial: the protocol never holds, controls, or has discretionary access to user funds.
- Let users simulate historical DCA performance before committing to any plan.
- Give users full transparency and control: they can cancel or modify their SIP at any time.
- Build on a generic subscription protocol that can support other recurring on-chain services in the future.

## 3.1 Non-Goals (v1)

- Custodial or centralized fund management.
- Cross-chain execution in a single SIP (each SIP is single-chain).
- Fiat on-ramp or off-ramp.
- Automated tax reporting.
- Mobile app (web-only for v1).
- Governance token or protocol token.

---

## 4. User Personas

### 4.1 Casual Investor ("Alex")
- Has some ETH/USDC in a self-custody wallet (MetaMask, Coinbase Wallet).
- Knows what crypto is but is not a DeFi power user.
- Wants to invest a fixed amount every week into BTC or ETH without thinking about it.
- Needs a clear simulation to understand what they're getting into.
- Will not read a whitepaper; needs clear language and a simple UI.

### 4.2 DeFi Power User ("Sam")
- Comfortable with smart contract interactions, gas, approvals, and on-chain transactions.
- Wants to DCA into a specific altcoin on a custom interval.
- Cares about the contract architecture, access controls, and the aggregator being used.
- Wants to inspect the contract source and verify the security model.
- May want to integrate SIP subscriptions with other DeFi positions.

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Frontend                         │
│  (Simulation · Dashboard · SIP Setup · Portfolio View)  │
└────────────────────────┬────────────────────────────────┘
                         │ REST / WebSocket
┌────────────────────────▼────────────────────────────────┐
│                        Backend                          │
│  ┌─────────────────┐   ┌──────────────┐   ┌──────────┐ │
│  │  Price History  │   │  Simulation  │   │Execution │ │
│  │    Service      │   │     API      │   │   Bot    │ │
│  └─────────────────┘   └──────────────┘   └──────────┘ │
└────────────────────────────────────────────────────────-┘
                         │ On-chain calls
┌────────────────────────▼────────────────────────────────┐
│                    Smart Contracts (EVM)                 │
│  ┌──────────────────────┐   ┌───────────────────────┐   │
│  │  Subscriptions.sol   │   │  SIPService.sol        │   │
│  │  (generic protocol)  │◄──│  (+ future services)   │   │
│  └──────────────────────┘   └───────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │ Swap
                    ┌────▼─────┐
                    │Aggregator│
                    │(1inch /  │
                    │Paraswap) │
                    └──────────┘
```

---

## 6. Smart Contracts

### 6.1 Subscriptions.sol

This is the core protocol contract. It is chain-agnostic and service-agnostic. Any service can integrate with it.

#### Responsibilities
- Store and manage subscription state for all users and all services.
- Enforce that only the designated executor (the bot's address) can trigger an execution.
- Enforce per-subscription constraints: token, amount, interval, expiry. (Max executions is not stored — it is implied by `(permitExpiry - subscriptionStartTime) / interval`.)
- Allow users to cancel subscriptions at any time.
- Emit events for all state changes so the backend can index them.

#### Subscription Data Model

```
Subscription {
  id:                    bytes32     // unique identifier (keccak of subscriber, service, token, nonce)
  subscriber:            address     // user's wallet
  service:               address     // address of the Service contract
  spendToken:            address     // token user is spending (e.g. USDC)
  amountPerCycle:        uint256     // amount to spend each execution
  interval:              uint256     // seconds between executions
  lastExecutionTime:     uint256     // unix timestamp of the last execution (set to start time at creation)
  subscriptionStartTime: uint256     // unix timestamp the subscription was created
  permitExpiry:          uint256     // Permit2 expiry; doubles as the cancellation marker
}
```

Notes on the model:
- There is no `active` flag. A subscription is considered active while `block.timestamp <= permitExpiry`. **Cancellation** simply sets `permitExpiry = block.timestamp`, so the subscription expires immediately.
- There is no `nextExecutionAt` field. The next valid execution is `lastExecutionTime + interval`. At creation `lastExecutionTime` is set to the start time, so the first execution happens one interval after subscribing.
- There is no `maxExecutions`/`executionsCount`. The total number of executions is bounded implicitly by the permit window: `(permitExpiry - subscriptionStartTime) / interval`.

#### Key Functions

| Function | Who calls it | Description |
|---|---|---|
| `subscribe(service, spendToken, amount, interval, permitSingle, signature)` | User | Creates a new subscription. The user passes a signed Permit2 `PermitSingle`; the contract registers it via `permit2.permit(...)`. The permit `amount` must cover `amount * (permit window / interval)`. |
| `cancel(subscriptionId)` | User | Cancels an active subscription immediately (sets `permitExpiry = now`). |
| `execute(subscriptionId)` | Bot (executor) | Validates timing, expiry and the subscriber's balance, then calls `service.execute(subscription)`. |
| `setExecutor(address, bool)` | Owner | Enables/disables an authorized executor address. |
| `registerService(address)` | Owner | Whitelists a Service contract. |
| `removeService(address)` | Owner | De-whitelists a Service contract. |
| `pause()` / `unpause()` | Owner | Emergency stop for `subscribe` and `execute`. |

#### Access Control & Safety Invariants

- Only a registered executor address can call `execute`. No other address can trigger an execution.
- `execute` validates that `block.timestamp >= lastExecutionTime + interval` before proceeding. Early execution reverts with `TooEarly`.
- `execute` validates that `block.timestamp <= permitExpiry`, otherwise it reverts with `SubscriptionNotActive` (this also covers cancelled subscriptions, whose `permitExpiry` was set to the cancellation time).
- `execute` validates that the subscriber holds at least `amountPerCycle`, otherwise it reverts with `InsufficientSubscriptionAmount`.
- The Subscriptions contract itself never holds user funds. Funds are pulled from the user's wallet at the moment of execution, via Permit2 (`permit2.transferFrom`).
- If the user revokes the Permit2 allowance or lets it expire, the next execution reverts harmlessly. The subscription remains in state and can be cancelled.
- A subscriber can cancel at any time, including between execution windows.
- `permit2` is a hardcoded constant (`0x000000000022D473030F116dDEE9F6B43aC78BA3`), the canonical Permit2 deployment present on all supported chains.

#### Intent / Approval Flow

1. User calls `ERC20.approve(Permit2, max)` once per spend token (a one-time, reusable approval to the canonical Permit2 contract).
2. User signs an off-chain Permit2 `PermitSingle` granting `Subscriptions` an allowance up to the subscription's expiry, then calls `Subscriptions.subscribe(...)` with the permit + signature. The contract registers the allowance via `permit2.permit(...)` and stores the subscription.
3. The bot monitors `SubscriptionCreated` events and schedules executions.
4. At each interval, bot calls `Subscriptions.execute(subscriptionId)`.
5. Subscriptions pulls `amountPerCycle` from the user via `permit2.transferFrom`, forwards it to the Service contract, which executes the swap and sends bought tokens back to the user.

---

### 6.2 SIPService.sol

Implements the specific logic for systematic investment plans. It conforms to the `IService` interface required by `Subscriptions.sol`.

#### Responsibilities
- Maintain a whitelist of supported output tokens (tokens users can buy).
- Integrate with an on-chain aggregator (1inch or Paraswap) to execute the swap at best available price.
- Send purchased tokens directly to the subscriber's wallet — never hold them.
- Enforce minimum output amounts (slippage protection).
- Collect a protocol fee per execution (initially 0, configurable up to a cap).

#### Key Functions

| Function | Who calls it | Description |
|---|---|---|
| `execute(subscription, outputToken, minOutputAmount, swapData)` | Subscriptions contract | Receives spend token, executes swap via aggregator, sends output to subscriber. |
| `addToken(address)` | Owner | Adds a token to the supported output token whitelist. |
| `removeToken(address)` | Owner | Removes a token from the whitelist. |
| `setFee(uint256 feeInUsdBps)` | Owner | Sets the per-execution fee. Capped at a maximum defined at deploy time. |
| `setAggregator(address)` | Owner | Updates the aggregator router address. |

#### Fee Model

- v1: fee = 0 (free).
- Future: flat fee per execution, denominated in USD (range: $0.01–$0.10), collected in the spend token at the time of execution, sent to a treasury address.
- Fee cap is hardcoded in the contract at deploy time and cannot be exceeded by the owner.

#### Slippage Protection

- The bot computes `minOutputAmount` off-chain (based on current price with a configurable slippage tolerance) and passes it into the `execute` call.
- The contract enforces that the aggregator returns at least `minOutputAmount` or the transaction reverts.
- Default slippage tolerance: 1% (configurable per subscription in future versions).

---

### 6.3 IService Interface

```solidity
interface IService {
    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool);
}
```

Any future service (e.g., recurring NFT minting, on-chain subscription payments, recurring DAO contributions) implements this interface and can be plugged into `Subscriptions.sol`.

---

## 7. Backend

### 7.1 Price History Service

A standalone microservice responsible for fetching, normalizing, and storing historical price data used by the simulation feature.

#### Responsibilities
- Ingest historical OHLCV data for all whitelisted tokens from an external price API (e.g., CoinGecko or CoinMarketCap).
- Store data in a time-series-friendly database (e.g., PostgreSQL with TimescaleDB extension).
- Run a periodic sync job to keep prices up to date (daily granularity for historical, hourly for recent).
- Expose an internal API consumed by the Simulation API.

#### Data Model

```
PriceRecord {
  token:      string    // token symbol or address
  chain:      string    // chain identifier
  timestamp:  datetime
  price_usd:  decimal
  volume_usd: decimal   // optional, for display
}
```

#### Endpoints (internal)

| Endpoint | Description |
|---|---|
| `GET /prices/{token}?from=&to=&interval=` | Return price series for a token over a date range |
| `GET /tokens` | Return list of supported tokens with metadata |

---

### 7.2 Simulation API

Consumed by the frontend to power the DCA simulation calculator.

#### Logic

Given user inputs:
- **Token**: which asset to buy
- **Amount per cycle**: how much to invest each time (in USD)
- **Interval**: how often (custom, expressed as number of days)
- **Start date**: when the SIP would have started
- **End date**: when to calculate up to (default: today)

The API replays the historical DCA strategy over the price data:
- At each execution date, compute how many tokens were bought at that price.
- Accumulate total tokens bought and total USD invested.
- Compute current portfolio value using latest price.
- Return P&L: absolute gain/loss in USD and percentage return.
- Compare against lump-sum alternative (investing the full amount on day 1).

#### Endpoints

| Endpoint | Description |
|---|---|
| `POST /simulate` | Run a DCA simulation with given parameters, return time-series portfolio data |
| `GET /tokens` | Return list of tokens available for simulation |

#### Simulation Response Shape

```json
{
  "totalInvested": "1200.00",
  "currentValue": "1843.27",
  "profitLoss": "643.27",
  "profitLossPercent": "53.6",
  "executionCount": 24,
  "averageBuyPrice": "43200.00",
  "currentPrice": "66540.00",
  "series": [
    { "date": "2024-01-01", "portfolioValue": "100.00", "invested": "100.00" },
    ...
  ],
  "lumpSumComparison": {
    "currentValue": "1596.00",
    "profitLossPercent": "33.0"
  }
}
```

---

### 7.3 Execution Bot

A backend service that monitors active subscriptions and submits execution transactions at the right time.

#### Responsibilities
- Index subscription events (`SubscriptionCreated`, `SubscriptionCancelled`, `Executed`) from the chain by listening to the `Subscriptions` contract.
- Maintain an internal schedule of pending executions (stored in DB).
- At each scheduled time, construct the aggregator swap calldata (via 1inch/Paraswap API), estimate gas, and submit `execute(subscriptionId, ...)` to the chain.
- Handle retries on transient failures (gas spike, RPC timeout) with exponential backoff.
- Monitor transaction inclusion and mark executions as succeeded or failed.
- Alert on repeated failures for a given subscription.

#### Execution Flow

```
1. Bot wakes up (cron / scheduler)
2. Query DB for subscriptions where last_execution_time + interval_seconds <= now
   and permit_expiry >= now (not yet expired/cancelled)
3. For each due subscription:
   a. Verify on-chain that the subscription has not expired (permitExpiry >= now)
      and the subscriber still holds at least amountPerCycle
   b. Call aggregator API to get best swap route and encoded calldata
   c. Estimate gas; skip if gas cost exceeds threshold (protect user)
   d. Submit execute() tx signed by bot's EOA
   e. Wait for inclusion; update DB with result and new last_execution_time
4. Emit execution record (success/failure) to DB for frontend to display
```

#### Bot Wallet Security

- The bot's private key is stored in a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault). It is never in the codebase or environment variables in plaintext.
- The bot's EOA has no ability to move user funds directly — it can only call `execute()` on the Subscriptions contract, which is constrained by the contract's invariants.
- Compromise of the bot key cannot lead to fund loss; it can only cause executions to happen out of schedule, which is bounded by the user's approved allowance and interval constraints.

#### Database Schema (bot-side)

```
subscriptions {
  id, subscriber_address, service_address, chain, spend_token,
  amount_per_cycle, interval_seconds, last_execution_time,
  subscription_start_time, permit_expiry, created_at
}

execution_log {
  id, subscription_id, executed_at, tx_hash, status,
  amount_spent, amount_received, output_token, price_at_execution,
  error_message
}
```

---

### 7.4 Frontend API (BFF — Backend for Frontend)

Aggregates data from on-chain state and the execution log to serve the dashboard.

#### Endpoints

| Endpoint | Description |
|---|---|
| `GET /subscriptions?address=` | Return all active and past subscriptions for a wallet |
| `GET /subscriptions/{id}/history` | Return execution history for a subscription |
| `GET /portfolio?address=` | Return aggregate portfolio: total invested, current value, P&L |
| `GET /tokens` | Return whitelisted token list with current price |

---

## 8. Frontend

### 8.1 Pages & Features

#### Landing Page
- Brief explanation of how SIP works.
- "Connect Wallet" CTA.
- Link to simulation calculator.

#### Simulation Calculator
- Inputs: token, investment amount per cycle, interval, start date.
- Visual output: line chart of portfolio value over time vs. invested capital vs. lump-sum alternative.
- Summary cards: total invested, current value, P&L %, average buy price.
- CTA: "Start this SIP" — pre-fills the SIP creation form with the simulated parameters.

#### Dashboard (requires wallet connected)
- Overview: total portfolio value, total invested, overall P&L.
- List of active SIPs with next execution countdown.
- List of past executions with token amount, price at execution, and tx hash link.
- Quick actions: Pause (if supported), Cancel SIP.

#### Create SIP
- Step 1: Select token to buy (from whitelisted list with prices).
- Step 2: Select spend token (e.g., USDC, USDT) and amount per cycle.
- Step 3: Set interval (e.g., every 7 days, every 30 days — custom input).
- Step 4: Optionally set a maximum number of executions or an end date.
- Step 5: Approve ERC-20 allowance (if not already approved) — wallet tx.
- Step 6: Create subscription — wallet tx to call `Subscriptions.subscribe(...)`.
- Confirmation screen with summary of the SIP.

#### SIP Detail Page
- All parameters of the subscription.
- Execution history table.
- Token accumulation chart over time.
- Cancel button (calls `Subscriptions.cancel(subscriptionId)`).

### 8.2 Wallet Support
- MetaMask
- WalletConnect (covers most mobile and hardware wallets)
- Coinbase Wallet

### 8.3 UX Principles
- Jargon is explained inline. "Approve" flows include plain-language explanations of what the user is signing and what the contract can and cannot do.
- Every wallet interaction shows a preview of what will happen before the user confirms.
- Simulation is accessible without connecting a wallet.
- Error states are human-readable: if a transaction fails, explain why in plain terms.

---

## 9. Security Considerations

### Smart Contract

- Contracts will be audited before mainnet deployment.
- `Subscriptions.sol` will be formally verified for the core invariants (funds only go to subscriber, executor is access-controlled, timing is enforced).
- No upgradeability in v1 — immutable contracts. New versions deployed as new contracts; users migrate by creating new subscriptions.
- Reentrancy guards on all state-modifying external calls.
- Token whitelist in `SIPService` prevents interaction with malicious or fee-on-transfer tokens that could break accounting.

### Backend

- Bot key stored in secrets manager, rotated periodically.
- Gas price caps to prevent execution during extreme gas spikes (configurable threshold).
- All user-facing API endpoints validate and sanitize inputs.
- Rate limiting on all public API endpoints.
- No user PII stored anywhere — only public wallet addresses.

### Frontend

- No private keys or mnemonics ever touch the frontend or backend.
- Content Security Policy headers set.
- All RPC calls made from the frontend go through the app's backend or a trusted provider (no user-provided RPC endpoints).

---

## 10. Success Metrics

| Metric | Target (6 months post-launch) |
|---|---|
| Active SIPs | 500 |
| Total volume executed | $500,000 |
| Execution success rate | ≥ 99% |
| Average SIP duration | ≥ 60 days |
| Simulation-to-SIP conversion rate | ≥ 20% |
| User-reported fund loss incidents | 0 |

---

## 11. Phased Roadmap

### Phase 1 — MVP
- Single EVM chain (to be determined: Base or Ethereum).
- Curated whitelist of 5–10 tokens (ETH, BTC wrapped, major stablecoins as spend tokens).
- Custom interval support.
- Simulation calculator.
- Dashboard with execution history.
- Fee: 0 (free).

### Phase 2 — Expansion
- Multi-chain support (deploy contracts on additional EVM chains).
- Expand token whitelist.
- Fee mechanism activated ($0.01–$0.10 per execution).
- Email/push notifications for execution events (opt-in).
- Slippage tolerance configurable per subscription.

### Phase 3 — Protocol Generalization
- Open up the Subscriptions + Services protocol for third-party service integrations.
- Developer documentation and SDK for building new Services.
- Recurring on-chain payments use case (e.g., pay for a dApp subscription in crypto).
- Governance: community input on token whitelisting and fee changes.

---

## 12. Open Questions

| # | Question | Owner | Priority |
|---|---|---|---|
| 1 | Which EVM chain is the launch chain? | Product | High |
| 2 | Which aggregator — 1inch or Paraswap? (or support both?) | Engineering | High |
| 3 | What is the initial token whitelist? | Product | High |
| 4 | What spend tokens are supported? (USDC only, or also ETH, USDT?) | Product | Medium |
| 5 | What gas price ceiling should the bot enforce before skipping an execution? | Engineering | Medium |
| 6 | What is the slippage tolerance default and is it user-configurable in v1? | Product | Medium |
| 7 | Who handles the audit and what is the timeline? | Engineering | High |
| 8 | What is the treasury address / multisig for fee collection in Phase 2? | Product | Low |
