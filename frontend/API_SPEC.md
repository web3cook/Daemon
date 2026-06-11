# Daemon — API Specification v1

Contract between the Next.js frontend and the backend. Both sides MUST follow the conventions below so no field-mapping layer is needed.

---

## 1. Conventions

| Topic | Convention | Example |
| --- | --- | --- |
| Base URL | `/api/v1` | `https://api.daemonagents.com/api/v1` |
| URL paths | kebab-case, plural resources | `/creator/agents` |
| JSON fields | `snake_case` | `subscriber_count` |
| IDs | opaque strings, prefixed by type | `agt_01HXX…`, `sub_01HXX…`, `pln_01HXX…`, `inv_01HXX…`, `pay_01HXX…` |
| Enum values | lowercase `snake_case` strings | `"one_time"`, `"past_due"` |
| Timestamps | ISO 8601 UTC, suffix `_at` / `_time` | `"created_at": "2026-06-11T09:30:00Z"` |
| Money | object, amount as string decimal | `{ "amount": "12.00", "currency": "USDC" }` |
| Wallet addresses | full checksummed string, field name `user_address` | `"0x7A3f9c4E…C9f2"` |
| User-scoped reads | `POST` with `user_address` in the body | `POST /user/subscriptions` |
| Pagination | `?page=1&limit=20` → `pagination` inside `details` | see §1.2 |
| Versioning | breaking changes bump `/v1` → `/v2` | — |

### 1.1 Universal response envelope

**Every** response — success and failure, all status codes — uses this exact shape:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {}
  }
}
```

| Field | Type | Rule |
| --- | --- | --- |
| `success` | boolean | `true` for 2xx, `false` otherwise |
| `data.code` | string | HTTP status code as a string: `"200"`, `"201"`, `"400"`, `"404"`, … |
| `data.message` | string | Human-readable summary, safe to show in the UI |
| `data.details` | object | The payload. On failure: `{}` (or `field_errors` / `error_code` when useful) |

Failure example:

```json
{
  "success": false,
  "data": {
    "code": "404",
    "message": "Agents not found",
    "details": {}
  }
}
```

Failure with machine-readable extras (optional):

```json
{
  "success": false,
  "data": {
    "code": "400",
    "message": "Request validation failed",
    "details": {
      "error_code": "validation_failed",
      "field_errors": { "name": "required" }
    }
  }
}
```

| HTTP / `data.code` | Used for |
| --- | --- |
| `"200"` | Successful read / update / cancel |
| `"201"` | Resource created |
| `"400"` | Validation failed, invalid plan |
| `"401"` | Missing/invalid signature or token |
| `"402"` | Payment required (x402 flow, §7) |
| `"403"` | Not the owner of the resource |
| `"404"` | Agent / subscription / user not found |
| `"409"` | Already subscribed, handle taken |
| `"422"` | Insufficient balance |

### 1.2 Pagination object

Lives inside `data.details` next to the list it describes:

```json
{
  "pagination": { "page": 1, "limit": 20, "total_items": 134, "total_pages": 7 }
}
```

### 1.3 Shared enums

```
pricing_model        = "flat" | "usage" | "hybrid"
billing_interval     = "one_time" | "weekly" | "monthly"
subscription_status  = "active" | "cancelled" | "expired" | "past_due"
agent_status         = "draft" | "live" | "paused" | "delisted"
invoice_status       = "paid" | "pending" | "failed"
payout_status        = "paid" | "scheduled" | "failed"
user_role            = "subscriber" | "creator"
agent_category       = "finance" | "productivity" | "career" | "engineering" | "research" | "other"
sort_option          = "popular" | "rating" | "price_asc" | "price_desc" | "newest"
```

---

## 2. Core resources

### 2.1 `user`

```json
{
  "user_id": "usr_01HXX",
  "user_address": "0x7A3f9c4E1b8D2f6A0c5E9B3d7F1a4C8e2B6dC9f2",
  "handle": "rohit",
  "roles": ["subscriber", "creator"],
  "created_at": "2026-06-11T09:30:00Z"
}
```

### 2.2 `agent` (marketplace card — list view)

```json
{
  "agent_id": "agt_01HXX",
  "name": "Pulse",
  "icon": "https://cdn.daemonagents.com/agents/pulse/icon.png",
  "logo": "https://cdn.daemonagents.com/agents/pulse/logo.png",
  "category": "finance",
  "tagline": "dca-agent",
  "short_description": "Dollar-cost averages into your portfolio on a schedule you set — no charts, no stress.",
  "services": ["auto-dca", "rebalance", "alerts"],
  "rating": 4.8,
  "rating_count": 312,
  "subscriber_count": 1214,
  "publisher_name": "Meridian Labs",
  "pricing_model": "flat",
  "from_price": { "amount": "19.00", "currency": "USDC" },
  "status": "live",
  "created_at": "2026-06-01T00:00:00Z"
}
```

### 2.3 `agent_detail` (= `agent` + the fields below)

```json
{
  "description": "Pulse executes a disciplined dollar-cost averaging strategy…",
  "plans": [ /* plan[] — see 2.4 */ ]
}
```

### 2.4 `plan`

```json
{
  "plan_id": "pln_01HXX",
  "name": "starter",
  "billing_interval": "monthly",
  "base_price": { "amount": "19.00", "currency": "USDC" },
  "usage_price": null,
  "usage_unit": null,
  "description": "1 portfolio · weekly buys · email summaries"
}
```

Hybrid/usage plan example:

```json
{
  "plan_id": "pln_01HYY",
  "name": "searcher",
  "billing_interval": "monthly",
  "base_price": { "amount": "24.00", "currency": "USDC" },
  "usage_price": { "amount": "0.50", "currency": "USDC" },
  "usage_unit": "application",
  "description": "Unlimited matching · pay per tailored application"
}
```

One-time plan: `"billing_interval": "one_time"`, `usage_price`/`usage_unit` null.

### 2.5 `subscription`

```json
{
  "id": "sub_01HXX",
  "agent_id": "agt_01HXX",
  "agent": "Tidy",
  "logo": "https://cdn.daemonagents.com/agents/tidy/logo.png",
  "plan_id": "pln_01HZZ",
  "plan_name": "standard",
  "status": "active",
  "billing_interval": "monthly",
  "usage_summary": "412 emails triaged this month",
  "last_payment_amount": { "amount": "12.00", "currency": "USDC" },
  "last_payment_time": "2026-06-01T00:00:14Z",
  "next_payment_amount": { "amount": "12.00", "currency": "USDC" },
  "next_payment_time": "2026-07-01T00:00:00Z",
  "started_at": "2026-04-01T00:00:00Z",
  "cancelled_at": null
}
```

`next_payment_amount` / `next_payment_time` are `null` once cancelled.

### 2.6 `invoice`

```json
{
  "invoice_id": "inv_01HXX",
  "description": "Monthly subscriptions",
  "amount": { "amount": "12.00", "currency": "USDC" },
  "status": "paid",
  "tx_hash": "0xabc123…",
  "issued_at": "2026-06-01T00:00:00Z",
  "paid_at": "2026-06-01T00:00:14Z"
}
```

---

## 3. Auth & onboarding (wallet-based)

### 3.1 `POST /auth/nonce`

Input:

```json
{ "user_address": "0x7A3f9c4E…C9f2" }
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Nonce generated",
    "details": {
      "nonce": "8f3b2c91",
      "sign_message": "daemon wants you to sign in with your wallet:\n0x7A3f…\nNonce: 8f3b2c91",
      "expires_at": "2026-06-11T09:35:00Z"
    }
  }
}
```

### 3.2 `POST /auth/verify`

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "signature": "0x9f8e7d…"
}
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Wallet verified",
    "details": {
      "is_new_user": true,
      "user": { /* user (§2.1) — handle is null until onboarding */ }
    }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "401",
    "message": "Invalid signature",
    "details": {}
  }
}
```

`is_new_user: true` → frontend shows the onboarding modal.

### 3.3 `POST /user/onboard`

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "handle": "rohit",
  "role": "subscriber"
}
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "201",
    "message": "User onboarded",
    "details": { "user": { /* user (§2.1) */ } }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "409",
    "message": "Handle already taken",
    "details": {}
  }
}
```

---

## 4. Marketplace (public)

### 4.1 `GET /agents`

Query params (all optional): `category` (`agent_category`), `search` (string), `sort` (`sort_option`, default `popular`), `page`, `limit`.

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {
      "agents": [ /* agent[] (§2.2) */ ],
      "pagination": { "page": 1, "limit": 20, "total_items": 6, "total_pages": 1 }
    }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "404",
    "message": "Agents not found",
    "details": {}
  }
}
```

### 4.2 `GET /agents/{agent_id}`

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": { "agent": { /* agent_detail (§2.2 + §2.3) */ } }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "404",
    "message": "Agent not found",
    "details": {}
  }
}
```

---

## 5. Subscriptions & billing

### 5.1 `POST /user/subscriptions` (list a user's subscriptions)

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "status": "active"
}
```

`status` optional (`subscription_status`, default `active`).

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {
      "subscriptions": [ /* subscription[] (§2.5) */ ],
      "summary": {
        "active_count": 1,
        "monthly_total": { "amount": "12.00", "currency": "USDC" }
      }
    }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "404",
    "message": "No subscriptions found",
    "details": {}
  }
}
```

### 5.2 `POST /subscriptions` (create)

For recurring plans the backend returns the on-chain payment intent the wallet must confirm; for `one_time` plans use the x402 flow (§7).

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "agent_id": "agt_01HXX",
  "plan_id": "pln_01HXX"
}
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "201",
    "message": "Subscription created",
    "details": {
      "subscription": { /* subscription (§2.5), status: "active" */ },
      "payment": {
        "contract_address": "0xDAE…",
        "network": "stellar",
        "amount": { "amount": "19.00", "currency": "USDC" },
        "memo": "sub_01HXX"
      }
    }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "409",
    "message": "Already subscribed to this agent",
    "details": {}
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "422",
    "message": "Insufficient USDC balance",
    "details": {}
  }
}
```

### 5.3 `POST /subscriptions/{subscription_id}/cancel`

Subscription stays active until the end of the paid period.

Input:

```json
{ "user_address": "0x7A3f9c4E…C9f2" }
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Subscription cancelled — active until Jul 1, 2026",
    "details": {
      "subscription": { /* subscription (§2.5), status: "cancelled", cancelled_at set */ }
    }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "404",
    "message": "Subscription not found",
    "details": {}
  }
}
```

### 5.4 `POST /user/billing` (payment-wallet card)

Input:

```json
{ "user_address": "0x7A3f9c4E…C9f2" }
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {
      "user_address": "0x7A3f9c4E…C9f2",
      "balance": { "amount": "142.50", "currency": "USDC" },
      "next_charge": {
        "amount": { "amount": "12.00", "currency": "USDC" },
        "charge_at": "2026-07-01T00:00:00Z"
      }
    }
  }
}
```

`next_charge` is `null` when there are no active subscriptions.

### 5.5 `POST /user/invoices`

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "page": 1,
  "limit": 20
}
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {
      "invoices": [ /* invoice[] (§2.6) */ ],
      "pagination": { "page": 1, "limit": 20, "total_items": 3, "total_pages": 1 }
    }
  }
}
```

---

## 6. Creator

### 6.1 `POST /creator/agents/list`

Input:

```json
{ "user_address": "0x7A3f9c4E…C9f2" }
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {
      "agents": [
        {
          "agent_id": "agt_01HXX",
          "name": "Pulse",
          "icon": "https://cdn.daemonagents.com/agents/pulse/icon.png",
          "logo": "https://cdn.daemonagents.com/agents/pulse/logo.png",
          "category": "finance",
          "tagline": "dca-agent",
          "status": "live",
          "subscriber_count": 1214,
          "monthly_recurring_revenue": { "amount": "4230.00", "currency": "USDC" },
          "created_at": "2026-06-01T00:00:00Z"
        }
      ]
    }
  }
}
```

### 6.2 `POST /creator/agents/register` (3-step form submits once)

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "name": "Nightwatch",
  "category": "engineering",
  "short_description": "Watches your endpoints overnight and files incident reports.",
  "services": ["uptime-checks", "alerting", "weekly-report"],
  "pricing_model": "hybrid",
  "plans": [
    {
      "name": "base",
      "billing_interval": "monthly",
      "base_price": { "amount": "29.00", "currency": "USDC" },
      "usage_price": { "amount": "0.10", "currency": "USDC" },
      "usage_unit": "run",
      "description": "Base monitoring + pay per incident run"
    }
  ]
}
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "201",
    "message": "Agent registered and live in the marketplace",
    "details": { "agent": { /* agent_detail, status: "live" */ } }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "400",
    "message": "Request validation failed",
    "details": {
      "error_code": "validation_failed",
      "field_errors": { "name": "required", "plans[0].base_price.amount": "must be > 0" }
    }
  }
}
```

### 6.3 `POST /creator/agents/update`

Input — `agent_id` + any subset of the §6.2 fields, plus `status` (`"live" | "paused"`):

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "agent_id": "agt_01HXX",
  "short_description": "Updated copy.",
  "status": "paused"
}
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Agent updated",
    "details": { "agent": { /* agent_detail */ } }
  }
}
```

```json
{
  "success": false,
  "data": {
    "code": "403",
    "message": "You do not own this agent",
    "details": {}
  }
}
```

### 6.4 `POST /creator/earnings`

Input:

```json
{ "user_address": "0x7A3f9c4E…C9f2" }
```

Output:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {
      "stats": {
        "net_monthly_recurring_revenue": { "amount": "3807.00", "currency": "USDC" },
        "mrr_change_percent": 8.2,
        "active_subscribers": 1214,
        "subscriber_change": 41,
        "next_payout": {
          "amount": { "amount": "1094.00", "currency": "USDC" },
          "payout_at": "2026-06-12T00:00:00Z"
        },
        "lifetime_revenue": { "amount": "38500.00", "currency": "USDC" }
      },
      "revenue_by_month": [
        { "month": "2025-11", "net": { "amount": "2210.00", "currency": "USDC" } },
        { "month": "2026-06", "net": { "amount": "3807.00", "currency": "USDC" } }
      ],
      "payouts": [
        {
          "payout_id": "pay_01HXX",
          "amount": { "amount": "1058.40", "currency": "USDC" },
          "status": "paid",
          "tx_hash": "0xdef456…",
          "payout_at": "2026-06-05T00:00:00Z"
        }
      ],
      "earnings_by_agent": [
        {
          "agent_id": "agt_01HXX",
          "agent_name": "Pulse",
          "subscriber_count": 1214,
          "monthly_recurring_revenue": { "amount": "3807.00", "currency": "USDC" }
        }
      ]
    }
  }
}
```

Notes: platform fee is 10%; all earnings figures are **net** of the fee. `revenue_by_month` covers the trailing 8 months, oldest first.

---

## 7. One-time usage fees: x402 flow (phase 2, Stellar)

One-time (`billing_interval: "one_time"`) and metered usage charges settle via the x402 protocol. Documented here so the backend can stub it; the frontend treats it as a normal request/retry.

1. Client calls the agent's service endpoint — `POST /agents/{agent_id}/invoke`:

Input:

```json
{
  "user_address": "0x7A3f9c4E…C9f2",
  "service_id": "cv-tailor",
  "input": {}
}
```

2. If unpaid, backend responds HTTP `402`:

```json
{
  "success": false,
  "data": {
    "code": "402",
    "message": "Payment required to invoke this service",
    "details": {
      "payment_requirements": {
        "scheme": "exact",
        "network": "stellar",
        "amount": { "amount": "0.50", "currency": "USDC" },
        "pay_to": "GDAEMON…XLM",
        "memo": "invk_01HXX",
        "expires_at": "2026-06-11T09:40:00Z"
      }
    }
  }
}
```

3. Client pays and retries the same request with header `X-Payment: <base64 payment proof>`.
4. Backend verifies settlement and responds HTTP `200`:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Service invoked",
    "details": {
      "invocation_id": "invk_01HXX",
      "status": "completed",
      "output": {},
      "receipt": { "tx_hash": "stellar:abc…", "settled_at": "2026-06-11T09:38:02Z" }
    }
  }
}
```

---

## 8. Frontend mapping notes (for the current UI)

| UI element | Endpoint |
| --- | --- |
| Marketplace grid | `GET /agents` |
| Agent detail + plans | `GET /agents/{agent_id}` |
| Subscribe confirm modal | `POST /subscriptions` |
| My subscriptions list + "$X/mo" summary | `POST /user/subscriptions` |
| Cancel button | `POST /subscriptions/{subscription_id}/cancel` |
| Payment-wallet card | `POST /user/billing` |
| Invoices card | `POST /user/invoices` |
| Connect wallet → onboarding modal | `POST /auth/nonce` → `POST /auth/verify` → `POST /user/onboard` |
| Creator "your listed agents" | `POST /creator/agents/list` |
| Register-agent 3-step flow (submits on publish) | `POST /creator/agents/register` |
| Edit listing | `POST /creator/agents/update` |
| Earnings dashboard | `POST /creator/earnings` |
