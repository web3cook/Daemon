# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agentic DCA** is a non-custodial on-chain dollar-cost averaging platform on **Arbitrum One** where an **autonomous AI agent** (registered via ERC-8004) executes recurring asset purchases on behalf of users. The agent autonomously pays for the external data it needs (price feeds, DEX routing) using **x402** micropayments in USDC. Smart contracts verify the agent's on-chain identity and trust score before accepting any execution.

The full product spec lives in `PRD.md`. Read it before making architectural decisions.

**Key innovations over v1:**
1. Executor is an ERC-8004 registered agent with verifiable on-chain identity and reputation.
2. Smart contracts query the ERC-8004 Validation Registry to enforce a minimum trust score before allowing `execute()`.
3. The agent uses the x402 protocol to autonomously pay for live price data and DEX routing APIs — no pre-negotiated API keys.
4. Target chain is Arbitrum One (not Base or Ethereum mainnet).

## Architecture

```
contracts/    # Solidity — Subscriptions.sol, SIPService.sol, ERC-8004 registries
backend/      # Node.js — Agent Executor (x402 client + ERC-8004 identity), Price History, Simulation API, BFF
frontend/     # React/Next.js — Dashboard, Create SIP, Agent Explorer, Simulation Calculator
```

---

## Smart Contracts (`contracts/`)

**Stack:** Foundry (tests + deployment scripts) + Hardhat (optional for tasks). All contracts deploy to Arbitrum One.

### Subscriptions.sol

Core protocol. Stores subscription state, enforces timing and expiry, pulls funds via Permit2. The critical v2 addition: `execute()` calls `ERC8004ValidationRegistry.getScore(agentId)` and reverts if below `minAgentTrustScore`. Owner maps agent EOAs to their ERC-8004 identity IDs via `setExecutor(eoa, agentId, enabled)`.

Data model fields: `id, subscriber, service, spendToken, amountPerCycle, interval, lastExecutionTime, subscriptionStartTime, permitExpiry`.

- No `active` flag. Active while `block.timestamp <= permitExpiry`.
- Cancel sets `permitExpiry = block.timestamp`.
- Permit2 constant: `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
- USDC on Arbitrum: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.

### SIPService.sol

Implements `IService`. Receives USDC from Subscriptions, executes swap via Uniswap v3 Universal Router or Camelot on Arbitrum, sends output token directly to subscriber. Maintains token whitelist (WETH, WBTC, ARB). Slippage enforced by `minOutputAmount` passed in `params` by the agent.

Arbitrum token addresses:
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
- WBTC: `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0F`
- ARB: `0x912CE59144191C1204E64559FE8253a0e49E6548`

### ERC-8004 Registries

Three contracts (deploy minimal versions for POC):

- **IdentityRegistry.sol** — ERC-721. `register()` mints an agent NFT. Token URI → AgentCard JSON at `.well-known/agent.json`.
- **ReputationRegistry.sol** — Accepts post-execution feedback. Score aggregated from verified submitters.
- **ValidationRegistry.sol** — Validators post trust scores (0–100) per agent. `Subscriptions.sol` reads this. For POC, protocol operator is the sole validator.

### IService Interface

```solidity
interface IService {
    function execute(address subscriber, address spendToken, uint256 amount, bytes calldata params) external returns (bool);
}
```

### Key Invariants to Preserve

- Funds flow: `user wallet → Subscriptions (transient) → SIPService → DEX → user wallet`. Nothing custodied.
- Agent trust score is read fresh (not cached) on every `execute()` call.
- Token whitelist prevents fee-on-transfer tokens from breaking accounting.

---

## Backend (`backend/`)

**Stack:** Node.js (TypeScript). PostgreSQL for persistence.

### Agent Executor (`backend/agent/`)

The core service. ERC-8004 registered. Runs a scheduler loop.

Per execution cycle:
1. Query DB for due subscriptions.
2. Call price feed API via **x402** — pay USDC, receive price data.
3. Call DEX routing API via **x402** — pay USDC, receive swap route + calldata.
4. Compute `minOutputAmount = routeOutput * (1 - slippageTolerance)`.
5. Call `Subscriptions.execute(subscriptionId)` signed by agent EOA.
6. Record result in DB; emit feedback to ReputationRegistry.

**x402 client module** wraps the x402 TypeScript SDK for Arbitrum USDC. When a 402 is received, it signs and submits payment then retries with proof header.

Agent EOA key: stored in secrets manager. Never in env files or code.

For POC: run a local mock x402 server (`backend/mock-x402/`) that returns canned price/route data and accepts x402 payment proofs without real settlement. This lets the full flow be tested before real x402 facilitators support Arbitrum.

### Price History Service (`backend/price-history/`)

Ingests OHLCV from CoinGecko. PostgreSQL storage. Serves Simulation API. Not used in live execution path (live prices come from x402-gated feed).

### Simulation API (`backend/simulation/`)

Stateless. Replays historical DCA given token + amount + interval + date range. Returns time-series portfolio data and lump-sum comparison.

### Frontend BFF (`backend/bff/`)

Aggregates on-chain + DB data. Adds `GET /agent/status` and `GET /agent/identity` endpoints (returns ERC-8004 identity card, trust score, x402 operational balance, execution stats).

### DB Schema additions vs v1

```
execution_log: add x402_payments_made (jsonb), x402_total_cost_usdc (decimal)
agent_state: agent_id, erc8004_identity_id, trust_score, total_executions, x402_balance_usdc
```

---

## Frontend (`frontend/`)

**Stack:** Next.js (App Router), wagmi v2, viem, RainbowKit (for MetaMask + WalletConnect + Coinbase Wallet on Arbitrum).

Four main pages:

- **Landing** — Explains agentic DCA. Shows agent trust score publicly. No wallet required.
- **Simulation Calculator** — Token/amount/interval/date → portfolio chart + P&L vs lump sum. No wallet required. "Start this SIP" CTA.
- **Dashboard** — Active SIPs, execution history (includes x402 costs per execution), overall P&L. Wallet required.
- **Create SIP** — 6-step flow: token → amount + interval → optional end date → approve USDC to Permit2 → sign PermitSingle + call `subscribe()`.
- **Agent Explorer** — ERC-8004 AgentCard, trust score history, execution stats, x402 cost per execution. Public page, no wallet required.

---

## x402 Integration Notes

x402 does not yet have an official facilitator on Arbitrum. For POC, use a local mock. For production:
- Option A: Deploy a minimal x402 facilitator contract on Arbitrum and run a facilitator server.
- Option B: Use Coinbase's x402 facilitator on Base and bridge; adds complexity, avoid for v1.

The x402 TypeScript SDK is the reference client: `npm install x402`. Configure with Arbitrum chain and USDC contract address. The agent wallet address that pays for x402 services must be pre-funded with operational USDC.

## ERC-8004 Notes

ERC-8004 is still in draft (not finalized). Deploy reference implementations from the ethereum-magicians discussion or write minimal versions matching the spec interfaces. Keep the registries upgradeable for POC (Transparent Proxy) since the spec may change. Remove upgradeability on mainnet.

The `.well-known/agent.json` AgentCard must be served from the agent's domain or a static host. Include: `agentId`, `capabilities: ["dca_execution", "x402_payment"]`, `serviceEndpoints.executor`, `x402PaymentAddress`.

## Open Decisions (from PRD §15)

Before scaffolding contracts, confirm:
1. ERC-8004 registry: deploy our own on Arbitrum or reference an existing deployment?
2. x402 facilitator on Arbitrum: mock only for POC, or also deploy minimal production facilitator?
3. DEX router: Uniswap v3 Universal Router vs Camelot (Camelot has better ARB liquidity; Uniswap is more battle-tested)
4. Minimum trust score default (50/100 proposed — is this right?)
5. Agent x402 operational wallet funding mechanism for Phase 2

## Testing

- Contracts: Foundry tests. Fork Arbitrum mainnet for integration tests (`ARBITRUM_RPC_URL` in env).
- Agent: Jest unit tests for x402 client and execution logic. Mock the chain.
- E2E: Arbitrum Sepolia testnet. Deploy all contracts. Run agent. Execute one subscription end-to-end.
