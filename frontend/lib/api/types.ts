// Types mirror API_SPEC.md exactly (snake_case). Keep both in sync.

export type PricingModel = "flat" | "usage" | "hybrid";
export type BillingInterval = "one_time" | "weekly" | "monthly";
export type SubscriptionStatus = "active" | "cancelled" | "expired" | "past_due";
export type AgentStatus = "draft" | "live" | "paused" | "delisted";
export type InvoiceStatus = "paid" | "pending" | "failed";
export type PayoutStatus = "paid" | "scheduled" | "failed";
export type UserRole = "subscriber" | "creator";
export type AgentCategory =
  | "finance"
  | "productivity"
  | "career"
  | "engineering"
  | "research"
  | "other";
export type SortOption = "popular" | "rating" | "price_asc" | "price_desc" | "newest";

export interface Money {
  amount: string;
  currency: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total_items: number;
  total_pages: number;
}

export interface User {
  user_id: string;
  user_address: string;
  handle: string | null;
  roles: UserRole[];
  created_at: string;
}

export interface Agent {
  agent_id: string;
  /** Service contract deployed via ServiceFactory on Arbitrum Sepolia. */
  service_address: string;
  name: string;
  icon: string;
  logo: string;
  category: AgentCategory;
  tagline: string;
  short_description: string;
  services: string[];
  rating: number;
  rating_count: number;
  subscriber_count: number;
  publisher_name: string;
  pricing_model: PricingModel;
  from_price: Money;
  status: AgentStatus;
  created_at: string;
}

export interface Plan {
  plan_id: string;
  name: string;
  billing_interval: BillingInterval;
  base_price: Money;
  usage_price: Money | null;
  usage_unit: string | null;
  description: string;
}

export interface AgentDetail extends Agent {
  description: string;
  plans: Plan[];
}

export interface Subscription {
  id: string;
  agent_id: string;
  agent: string;
  logo: string;
  plan_id: string;
  plan_name: string;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  usage_summary: string;
  last_payment_amount: Money;
  last_payment_time: string;
  next_payment_amount: Money | null;
  next_payment_time: string | null;
  started_at: string;
  cancelled_at: string | null;
}

export interface Invoice {
  invoice_id: string;
  description: string;
  amount: Money;
  status: InvoiceStatus;
  tx_hash: string;
  issued_at: string;
  paid_at: string;
}

export interface CreatorAgent {
  agent_id: string;
  name: string;
  icon: string;
  logo: string;
  category: AgentCategory;
  tagline: string;
  status: AgentStatus;
  subscriber_count: number;
  monthly_recurring_revenue: Money;
  created_at: string;
}

export interface PaymentIntent {
  contract_address: string;
  network: string;
  amount: Money;
  memo: string;
}

// ── request payloads ──────────────────────────────

export interface PlanInput {
  name: string;
  billing_interval: BillingInterval;
  base_price: Money;
  usage_price: Money | null;
  usage_unit: string | null;
  description: string;
}

export interface RegisterAgentInput {
  user_address: string;
  /** Service contract deployed via ServiceFactory.createService() on Arbitrum Sepolia. */
  service_address: string;
  name: string;
  category: AgentCategory;
  short_description: string;
  services: string[];
  pricing_model: PricingModel;
  plans: PlanInput[];
}

export interface UpdateAgentInput {
  user_address: string;
  agent_id: string;
  name?: string;
  category?: AgentCategory;
  short_description?: string;
  services?: string[];
  pricing_model?: PricingModel;
  plans?: PlanInput[];
  status?: "live" | "paused";
}

// ── response `details` payloads ───────────────────

export interface AgentListDetails {
  agents: Agent[];
  pagination: Pagination;
}

export interface AgentDetailDetails {
  agent: AgentDetail;
}

export interface NonceDetails {
  nonce: string;
  sign_message: string;
  expires_at: string;
}

export interface VerifyDetails {
  is_new_user: boolean;
  user: User;
}

export interface UserDetails {
  user: User;
}

export interface SubscriptionListDetails {
  subscriptions: Subscription[];
  summary: {
    active_count: number;
    monthly_total: Money;
  };
}

export interface CreateSubscriptionDetails {
  subscription: Subscription;
  payment: PaymentIntent;
}

export interface CancelSubscriptionDetails {
  subscription: Subscription;
}

export interface BillingDetails {
  user_address: string;
  balance: Money;
  next_charge: {
    amount: Money;
    charge_at: string;
  } | null;
}

export interface InvoiceListDetails {
  invoices: Invoice[];
  pagination: Pagination;
}

export interface CreatorAgentListDetails {
  agents: CreatorAgent[];
}

export interface AgentMutationDetails {
  agent: AgentDetail;
}

export interface EarningsDetails {
  stats: {
    net_monthly_recurring_revenue: Money;
    mrr_change_percent: number;
    active_subscribers: number;
    subscriber_change: number;
    next_payout: {
      amount: Money;
      payout_at: string;
    };
    lifetime_revenue: Money;
  };
  revenue_by_month: { month: string; net: Money }[];
  payouts: {
    payout_id: string;
    amount: Money;
    status: PayoutStatus;
    tx_hash: string;
    payout_at: string;
  }[];
  earnings_by_agent: {
    agent_id: string;
    agent_name: string;
    subscriber_count: number;
    monthly_recurring_revenue: Money;
  }[];
}
