# Product Requirements Document: Agentic DCA — Autonomous On-Chain Investment via x402 + ERC-8004

**Version:** 2.0  
**Date:** 2026-06-08  
**Status:** Draft  
**Target Network:** Arbitrum One

---

## 1. Overview

Agentic DCA is a non-custodial, on-chain systematic investment platform where **autonomous AI agents** execute recurring asset purchases on behalf of users. Unlike a traditional cron bot, each execution agent has a verified on-chain identity (ERC-8004), autonomously pays for the external data it needs to operate (x402), and is authorized by the user's smart contract only after its identity and trust score are verified.

The system combines three primitives:

| Primitive | Role |
|---|---|
| **Subscriptions.sol + SIPService.sol** | On-chain permission layer — stores user intent, enforces timing, pulls funds via Permit2 |
| **ERC-8004** | Agent trust layer — registers the execution agent's identity on-chain; smart contract validates agent before executing |
| **x402** | Agent payment layer — the agent autonomously pays for price data and routing APIs in USDC micropayments during each execution cycle |

For the POC, the concrete action is **periodic USDC → WETH / WBTC purchases on Arbitrum One** via Uniswap v3 or Camelot. The architecture is generic: any agentic action (yield rebalancing, recurring NFT mints, on-chain subscription payments) can be scheduled by implementing a new `IService`.

---

## 2. Problem Statement

Traditional DCA bots are centralized executors: they hold keys, lack verifiable identity, and depend on opaque off-chain logic. Users must fully trust the operator. On-chain DCA has improved custody but the execution layer remains a dumb cron job with no intelligence or accountability.

Meanwhile, AI agents are increasingly being used to manage on-chain portfolios, but they lack:
1. **Verifiable identity** — there is no on-chain way for a smart contract to confirm it is dealing with a specific, reputable agent rather than an impersonator.
2. **Autonomous resource acquisition** — agents need live price data and routing quotes to operate safely, but acquiring these requires pre-negotiated API keys and centralized coordination.
3. **User-controllable authorization** — users cannot grant fine-grained, revocable authority to an AI agent in the same way they do with human counterparties.

x402 and ERC-8004 together close these gaps and enable a new class of trustless agentic commerce.

---

## 3. Goals

- Allow any Arbitrum user to set up a recurring crypto investment plan in under 5 minutes, executed by a verified autonomous agent.
- The execution agent must have a verifiable ERC-8004 identity; the smart contract must validate this identity before accepting any `execute()` call.
- The agent autonomously pays for the external data it needs (price feeds, swap routing) via x402 micropayments — no pre-negotiated API keys, no centralized coordination.
- Remain fully non-custodial: the agent never holds user funds; Permit2 transfers happen only within approved parameters.
- Generalise the architecture so any recurring agentic action can be plugged in as a new `IService`.

## 3.1 Non-Goals (v1 / POC)

- Custodial fund management of any kind.
- Multi-chain execution in a single subscription.
- Fiat on-ramp or off-ramp.
- The agent making discretionary investment decisions — timing is fixed by interval, amounts are fixed by subscription. Agent intelligence is scoped to data acquisition and execution safety checks.
- Governance token.
- Mobile app (web-only).

---

## 4. User Personas

### 4.1 Passive Investor ("Alex")
- Holds USDC on Arbitrum.
- Wants to DCA into ETH every week without touching a browser.
- Needs assurance that the agent executing their plan is trustworthy and has an on-chain track record.
- Will not manage API keys or run infrastructure.

### 4.2 DeFi Power User ("Sam")
- Wants to verify the agent's ERC-8004 identity and reputation score before subscribing.
- Wants to understand exactly what x402 payments the agent makes during each cycle and what they cost.
- May want to authorize multiple agents (different strategies) and compare their execution quality.
- Wants to inspect all contract source code.

### 4.3 Agent Developer ("Dev")
- Wants to build a new agentic service (e.g., recurring yield optimization) that plugs into the Subscriptions protocol.
- Needs a clear `IService` interface and an ERC-8004 registration flow.
- Wants to use x402 to monetize data services they expose to other agents.

---

## 5. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                          Frontend                            │
│   (Simulation · Dashboard · Subscribe · Agent Explorer)      │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST / WebSocket
┌───────────────────────────▼──────────────────────────────────┐
│                          Backend                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │  Price History  │  │  Simulation  │  │  Agent Executor │ │
│  │    Service      │  │     API      │  │  (ERC-8004 ID)  │ │
│  └─────────────────┘  └──────────────┘  └────────┬────────┘ │
└──────────────────────────────────────────────────┼──────────-┘
          x402 micropayments (USDC)                │
┌─────────────────────────────┐                    │ execute()
│   External Data Services    │                    │
│  ┌──────────────────────┐   │   ┌────────────────▼──────────────────┐
│  │  Price Feed API      │   │   │         Smart Contracts            │
│  │  (x402-gated)        │   │   │  ┌────────────────────────────┐   │
│  └──────────────────────┘   │   │  │     Subscriptions.sol       │   │
│  ┌──────────────────────┐   │   │  │  (validates ERC-8004 agent) │   │
│  │  DEX Routing API     │   │   │  └─────────────┬──────────────┘   │
│  │  (x402-gated)        │   │   │                │                  │
│  └──────────────────────┘   │   │  ┌─────────────▼──────────────┐   │
└─────────────────────────────┘   │  │      SIPService.sol         │   │
                                  │  │  (Uniswap v3 / Camelot)     │   │
                                  │  └─────────────────────────────┘   │
                                  │                                     │
                                  │  ┌──────────────────────────────┐  │
                                  │  │   ERC-8004 Registries         │  │
                                  │  │  (Identity · Reputation ·     │  │
                                  │  │   Validation)                 │  │
                                  │  └──────────────────────────────┘  │
                                  └────────────────────────────────────┘
                                              │ Swap
                                         ┌────▼──────────┐
                                         │  Uniswap v3   │
                                         │  / Camelot    │
                                         │  (Arbitrum)   │
                                         └───────────────┘
```

---

## 6. Smart Contracts

All contracts deploy to **Arbitrum One**. Hardhat + Foundry for development and testing.

### 6.1 Subscriptions.sol

Core protocol contract — unchanged in structure from v1 but with one critical addition: **the executor check now validates the calling agent's ERC-8004 identity**.

#### Subscription Data Model

```
Subscription {
  id:                    bytes32   // keccak256(subscriber, service, spendToken, nonce)
  subscriber:            address   // user wallet
  service:               address   // IService contract address
  spendToken:            address   // USDC (Arbitrum: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831)
  amountPerCycle:        uint256   // USDC amount per execution (6 decimals)
  interval:              uint256   // seconds between executions
  lastExecutionTime:     uint256   // unix timestamp of last execution
  subscriptionStartTime: uint256   // unix timestamp of creation
  permitExpiry:          uint256   // Permit2 expiry = cancellation marker
}
```

Same invariants as v1:
- No `active` flag; active while `block.timestamp <= permitExpiry`.
- Cancellation sets `permitExpiry = block.timestamp`.
- Execution cap implicit: `(permitExpiry - subscriptionStartTime) / interval`.

#### Agent-Gated Executor Check

`execute()` now requires the `msg.sender` to pass two checks:
1. It is in the `authorizedExecutors` mapping (set by owner via `setExecutor`).
2. Its ERC-8004 agent ID (stored in `agentIds[msg.sender]`) has a minimum trust score from the configured Validation Registry.

```solidity
modifier onlyTrustedAgent() {
    require(authorizedExecutors[msg.sender], "NotExecutor");
    uint256 agentId = agentIds[msg.sender];
    require(agentId != 0, "AgentNotRegistered");
    uint256 score = erc8004ValidationRegistry.getScore(agentId);
    require(score >= minAgentTrustScore, "InsufficientAgentTrust");
    _;
}
```

`minAgentTrustScore` is owner-configurable (default: 50/100).

#### Key Functions

| Function | Caller | Description |
|---|---|---|
| `subscribe(service, spendToken, amount, interval, permitSingle, signature)` | User | Creates subscription; registers Permit2 allowance |
| `cancel(subscriptionId)` | User | Sets `permitExpiry = now`; subscription expires immediately |
| `execute(subscriptionId)` | Agent (ERC-8004 registered executor) | Validates timing, expiry, agent trust, then calls `service.execute()` |
| `setExecutor(address executor, uint256 agentId, bool enabled)` | Owner | Maps an EOA to its ERC-8004 agent ID and enables/disables it |
| `setMinTrustScore(uint256)` | Owner | Updates the minimum ERC-8004 validation score required |
| `registerService(address)` | Owner | Whitelists an IService contract |
| `pause()` / `unpause()` | Owner | Emergency stop |

#### Safety Invariants (same as v1)

- `block.timestamp >= lastExecutionTime + interval` before execution (`TooEarly` revert).
- `block.timestamp <= permitExpiry` (`SubscriptionNotActive` revert).
- Subscriber holds at least `amountPerCycle` (`InsufficientSubscriptionAmount` revert).
- Contract never holds funds. Permit2 `transferFrom` happens atomically at execution.
- Permit2 constant: `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

---

### 6.2 SIPService.sol

Implements `IService` for asset purchases on Arbitrum. Integrates with Uniswap v3 and/or Camelot DEX.

#### Responsibilities
- Accept spend token from Subscriptions, execute swap via Uniswap v3 Universal Router or Camelot router.
- Send purchased tokens directly to subscriber — never hold them.
- Enforce `minOutputAmount` (slippage protection computed by agent off-chain).
- Maintain whitelist of supported output tokens.
- Collect optional protocol fee (v1: 0).

#### Arbitrum Token Addresses (initial whitelist)

| Token | Address |
|---|---|
| USDC (native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| USDC.e (bridged) | `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` |
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |
| WBTC | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0F` |
| ARB | `0x912CE59144191C1204E64559FE8253a0e49E6548` |

#### Key Functions

| Function | Caller | Description |
|---|---|---|
| `execute(subscriber, spendToken, amount, params)` | Subscriptions | `params` encodes `(outputToken, minOutputAmount, swapPath)`. Executes swap and sends output to subscriber. |
| `addToken(address)` | Owner | Adds output token to whitelist |
| `removeToken(address)` | Owner | Removes token from whitelist |
| `setFee(uint256 bps)` | Owner | Sets protocol fee. Capped at deploy-time constant. |
| `setRouter(address)` | Owner | Updates DEX router address |

---

### 6.3 ERC-8004 Registries (deployed or referenced)

The product either deploys its own minimal ERC-8004 registry on Arbitrum or references an existing deployment if one exists by launch time.

Three registry contracts:

**IdentityRegistry.sol** — ERC-721 based. Each agent mints a unique NFT representing its identity. The token URI points to an AgentCard JSON hosted at a `.well-known/` endpoint.

**ReputationRegistry.sol** — Accepts execution feedback records. After each successful `execute()`, Subscriptions emits a feedback event that the agent can use to request a reputation update. Score is aggregated from verified feedback.

**ValidationRegistry.sol** — Validator contracts (initially operated by the protocol) re-execute agent logic or attest via TEE/ZK proofs and post validation scores (0–100) on-chain. `Subscriptions.sol` reads these scores.

#### Agent Card Schema (hosted at `.well-known/agent.json`)

```json
{
  "agentId": "<uint256 from IdentityRegistry>",
  "name": "SIP Executor Agent v1",
  "description": "Executes DCA subscriptions on Arbitrum; pays for data via x402",
  "serviceEndpoints": {
    "executor": "<agent EOA address>"
  },
  "capabilities": ["dca_execution", "x402_payment", "permit2_transfer"],
  "trustModels": ["reputation", "validation"],
  "x402PaymentAddress": "<agent USDC wallet for x402 top-ups>"
}
```

---

### 6.4 IService Interface

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

Any future agentic service implements this and registers with Subscriptions.

---

## 7. x402 Integration

x402 is the payment rail the agent uses to autonomously acquire the external data it needs during each execution cycle. The agent's operational USDC balance is funded by a small fraction of protocol fees (Phase 2) or a pre-funded operator wallet (POC).

### 7.1 Services the Agent Pays for via x402

| Service | x402 Payment | Data Returned |
|---|---|---|
| Price Feed API | ~$0.001 USDC per call | Current token price for slippage calc |
| DEX Routing API | ~$0.001 USDC per call | Best swap route + encoded calldata |
| Gas Estimator API | ~$0.0005 USDC per call | Arbitrum current gas price estimate |

For POC, these services can be mock x402 servers running locally or using a public x402-compatible data provider if one is available on Arbitrum.

### 7.2 x402 Payment Flow (per execution cycle)

```
1. Agent determines a subscription is due
2. Agent sends GET /price/{token} to price feed API
   → Receives HTTP 402 with payment requirements
   → Agent pays X USDC from its wallet via x402 protocol
   → Price data returned
3. Agent sends GET /route?from=USDC&to=WETH&amount=N to routing API
   → Same 402 → pay → route data returned
4. Agent computes minOutputAmount = routeOutput * (1 - slippageTolerance)
5. Agent submits execute(subscriptionId, minOutputAmount, swapData) to Subscriptions.sol
```

### 7.3 x402 on Arbitrum

x402's official facilitators currently focus on Base and Polygon. For Arbitrum:
- The protocol implements a minimal **x402 facilitator** contract on Arbitrum that verifies payment proofs.
- The agent uses the x402 TypeScript SDK with a custom Arbitrum provider configured for USDC on Arbitrum.
- Payment settlement is USDC → service operator wallet, verified on-chain.

---

## 8. ERC-8004 Agent Trust Flow

```
Deploy time:
  1. Protocol deploys IdentityRegistry, ReputationRegistry, ValidationRegistry on Arbitrum
  2. Agent operator calls IdentityRegistry.register() → receives agentId (NFT)
  3. Agent operator calls Subscriptions.setExecutor(agentEOA, agentId, true)
  4. Validator attests to agent's code and behavior → ValidationRegistry stores score

Subscription creation:
  5. User calls Subscriptions.subscribe(...) → no agent interaction needed

Execution time:
  6. Agent calls Subscriptions.execute(subscriptionId)
  7. Subscriptions calls ValidationRegistry.getScore(agentId) → must be >= minTrustScore
  8. If trusted: Subscriptions executes; emits Executed event
  9. After execution: Subscriptions emits AgentFeedback event with execution result
  10. Agent (or protocol) submits positive feedback to ReputationRegistry → score improves

Cancellation / agent compromise:
  11. Owner calls setExecutor(agentEOA, agentId, false) to revoke immediately
  12. ValidatorRegistry score can be set to 0 to freeze all new executions
```

---

## 9. Backend

### 9.1 Agent Executor

The core backend service. Runs as a Node.js process. Has an ERC-8004 registered identity.

#### Responsibilities
- Index `SubscriptionCreated`, `SubscriptionCancelled`, `Executed` events from Subscriptions contract on Arbitrum.
- Maintain execution schedule in PostgreSQL.
- Per execution cycle:
  - Acquire price data via x402 (pay → receive).
  - Acquire swap route via x402 (pay → receive).
  - Compute `minOutputAmount` with configured slippage.
  - Submit `execute()` to Subscriptions.sol signed by agent EOA.
  - Record result and emit feedback to ReputationRegistry.
- Retry with exponential backoff on transient failures.
- Skip execution if Arbitrum gas price exceeds configured ceiling (default: 0.1 gwei).

#### x402 Client Module

```typescript
// Wraps x402 TypeScript SDK for Arbitrum USDC payments
class X402Client {
  async fetchWithPayment(url: string): Promise<Response> {
    // 1. Send request
    // 2. If 402, extract payment requirements
    // 3. Sign and submit USDC payment on Arbitrum
    // 4. Retry request with payment proof header
  }
}
```

#### Agent EOA Security
- Private key in AWS Secrets Manager / HashiCorp Vault.
- Agent wallet holds only operational USDC (for x402 payments) and ETH (for gas).
- Compromise of agent key cannot move user funds — Subscriptions.sol enforces all constraints.

#### Database Schema

```
subscriptions {
  id, subscriber_address, service_address, spend_token,
  amount_per_cycle, interval_seconds, last_execution_time,
  subscription_start_time, permit_expiry, created_at
}

execution_log {
  id, subscription_id, executed_at, tx_hash, status,
  amount_spent, amount_received, output_token,
  price_at_execution, swap_route, x402_payments_made,
  x402_total_cost_usdc, error_message
}

agent_state {
  agent_id, erc8004_identity_id, trust_score,
  total_executions, total_x402_spent, wallet_balance_usdc
}
```

---

### 9.2 Price History Service

Unchanged from v1. Ingests OHLCV from CoinGecko/CoinMarketCap, stores in PostgreSQL, serves the Simulation API. Not involved in live execution (live prices come from x402-gated feeds).

---

### 9.3 Simulation API

Unchanged from v1. Stateless replay of historical DCA. Used by frontend calculator.

---

### 9.4 Frontend API (BFF)

Adds agent-specific endpoints to v1:

| Endpoint | Description |
|---|---|
| `GET /subscriptions?address=` | All subscriptions for a wallet |
| `GET /subscriptions/{id}/history` | Execution history including x402 costs |
| `GET /portfolio?address=` | Aggregate P&L |
| `GET /tokens` | Whitelisted tokens with current price |
| `GET /agent/status` | Current agent trust score, x402 balance, execution stats |
| `GET /agent/identity` | Agent's ERC-8004 identity card |

---

## 10. Frontend

### 10.1 Pages

#### Landing Page
- Explains the agentic DCA concept: "An autonomous agent executes your plan — with a verified on-chain identity."
- Shows agent trust score and execution history publicly.
- Connect wallet CTA.

#### Simulation Calculator
- Same as v1 (no wallet required).
- "Start this SIP" CTA pre-fills create form.

#### Dashboard (wallet required)
- Active subscriptions with next-execution countdown.
- Per-execution history: amount bought, price, tx hash, x402 data costs.
- Agent status panel: ERC-8004 identity, trust score, total executions.
- Cancel SIP button.

#### Create SIP
1. Select output token (WETH, WBTC, ARB).
2. Set USDC amount per cycle.
3. Set interval (daily, weekly, monthly, custom).
4. Optionally set end date.
5. Approve USDC to Permit2 (wallet tx).
6. Sign Permit2 `PermitSingle` + call `subscribe()` (wallet tx).
7. Confirmation screen.

#### Agent Explorer (new page)
- Shows the agent's ERC-8004 AgentCard.
- Reputation score history chart.
- All-time execution stats: success rate, average slippage, x402 cost per execution.
- Links to on-chain registry contracts and agent source code.

### 10.2 Wallet Support
- MetaMask, WalletConnect, Coinbase Wallet (Arbitrum network).

---

## 11. Security Considerations

### Smart Contracts
- Contracts audited before mainnet. Formal verification on Subscriptions.sol core invariants.
- No upgradeability in v1 — immutable. Migrations are new deployments.
- Reentrancy guards on all external calls.
- ERC-8004 trust score check is a read-only view call; it cannot be manipulated in-flight.
- Token whitelist prevents fee-on-transfer or rebase tokens from breaking accounting.

### Agent / x402
- Agent wallet holds minimal operational USDC only. Never holds user funds.
- x402 payments are bounded per execution (configurable max cost ceiling).
- If x402 data service returns bad data (wrong price), agent still enforces `minOutputAmount` on-chain — worst case: transaction reverts, no funds lost.
- Agent EOA key in secrets manager, rotated quarterly.

### ERC-8004
- Trust score is queried fresh at each `execute()` call — stale cached scores are not used.
- Owner can revoke executor status instantly to freeze a compromised agent.
- Validation registry scores can be zeroed by validators if misbehavior is detected.

---

## 12. POC Scope (What Gets Built First)

The POC proves the full x402 + ERC-8004 + DCA loop end-to-end on Arbitrum.

| Component | POC Implementation |
|---|---|
| `Subscriptions.sol` | Full implementation with ERC-8004 trust check |
| `SIPService.sol` | Uniswap v3 swap on Arbitrum One |
| ERC-8004 Registries | Minimal deploy: IdentityRegistry + ValidationRegistry only (Reputation optional) |
| Agent Executor | Node.js service, registered on ERC-8004, performs USDC→WETH DCA |
| x402 Integration | Mock x402 server providing price/route data; agent pays per call using x402 TypeScript SDK on Arbitrum |
| Frontend | Dashboard + Create SIP + Agent Explorer (no simulation calculator for POC) |
| Spend token | USDC on Arbitrum (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`) |
| Output tokens | WETH, WBTC |
| Interval | Minimum 1 hour for POC (no daily minimum enforced at contract level) |

---

## 13. Success Metrics

| Metric | POC Target | 6-Month Target |
|---|---|---|
| End-to-end executions on testnet | 10 | — |
| Agent ERC-8004 trust score | ≥ 80/100 | ≥ 90/100 |
| x402 payments successfully processed | 10 | — |
| Active subscriptions (mainnet) | — | 200 |
| Total volume executed | — | $100,000 |
| Execution success rate | ≥ 95% | ≥ 99% |
| User-reported fund loss | 0 | 0 |

---

## 14. Phased Roadmap

### Phase 1 — POC (Arbitrum testnet → mainnet)
- Subscriptions.sol + SIPService.sol on Arbitrum.
- ERC-8004 identity + validation for agent.
- x402 mock data services (price + routing).
- USDC → WETH/WBTC DCA.
- Minimal frontend: Create + Dashboard + Agent Explorer.

### Phase 2 — Production Agent
- x402 connections to real production data APIs.
- Full ERC-8004 Reputation registry with post-execution feedback loop.
- Slippage tolerance configurable per subscription.
- Fee mechanism (funded from small execution fee, offsets agent's x402 costs).
- Email/push execution notifications (opt-in).

### Phase 3 — Open Agentic Protocol
- Multiple agents can register and compete for subscriptions (user selects preferred agent by trust score).
- New IService implementations: yield rebalancing, recurring NFT mints, on-chain subscription payments.
- Agent SDK: developer toolkit for building new ERC-8004 + x402 enabled agentic services.
- Agent marketplace: browse agents by capability, reputation, and cost.

---

## 15. Open Questions

| # | Question | Owner | Priority |
|---|---|---|---|
| 1 | Is there an existing ERC-8004 registry deployment on Arbitrum, or do we deploy our own? | Engineering | High |
| 2 | Which x402 facilitator supports Arbitrum USDC? Deploy our own or wait for ecosystem? | Engineering | High |
| 3 | Uniswap v3 Universal Router or Camelot for swaps? (Camelot is Arbitrum-native, deeper ARB liquidity) | Engineering | High |
| 4 | Initial token whitelist beyond WETH and WBTC? | Product | Medium |
| 5 | What is the minimum trust score required (default 50/100)? | Product | Medium |
| 6 | How does the agent's operational USDC wallet get topped up to cover x402 payments? | Engineering | Medium |
| 7 | Who operates the Validation Registry validator in POC? (Protocol-owned initially) | Engineering | High |
| 8 | What is the gas ceiling on Arbitrum before agent skips an execution? | Engineering | Low |
