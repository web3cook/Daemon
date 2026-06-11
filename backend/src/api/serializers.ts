import { money } from './response.js'

export interface SubscriptionJoinRow {
  id: string
  status: string
  usage_count: number
  last_payment_amount: string | null
  last_payment_currency: string | null
  last_payment_time: Date | null
  next_payment_amount: string | null
  next_payment_currency: string | null
  next_payment_time: Date | null
  started_at: Date
  cancelled_at: Date | null
  agent_id: string
  agent_name: string
  agent_logo: string | null
  usage_label: string | null
  plan_id: string
  plan_name: string
  billing_interval: string
}

export function serializeSubscription(row: SubscriptionJoinRow): object {
  return {
    id: row.id,
    agent_id: row.agent_id,
    agent: row.agent_name,
    logo: row.agent_logo,
    plan_id: row.plan_id,
    plan_name: row.plan_name,
    status: row.status,
    billing_interval: row.billing_interval,
    usage_summary: row.usage_label ? `${row.usage_count} ${row.usage_label}` : null,
    last_payment_amount: row.last_payment_amount !== null ? money(row.last_payment_amount, row.last_payment_currency ?? 'USDC') : null,
    last_payment_time: row.last_payment_time ? row.last_payment_time.toISOString() : null,
    next_payment_amount: row.status === 'cancelled' || row.next_payment_amount === null ? null : money(row.next_payment_amount, row.next_payment_currency ?? 'USDC'),
    next_payment_time: row.status === 'cancelled' || row.next_payment_time === null ? null : row.next_payment_time.toISOString(),
    started_at: row.started_at.toISOString(),
    cancelled_at: row.cancelled_at ? row.cancelled_at.toISOString() : null,
  }
}

export interface AgentRow {
  agent_id: string
  name: string
  icon: string | null
  logo: string | null
  category: string
  tagline: string | null
  short_description: string | null
  description?: string | null
  services: string[]
  rating: string
  rating_count: number
  base_subscriber_count: number
  publisher_name: string | null
  pricing_model: string
  status: string
  created_at: Date
  from_price_amount?: string | null
  from_price_currency?: string | null
}

export function serializeAgentCard(row: AgentRow): object {
  return {
    agent_id: row.agent_id,
    name: row.name,
    icon: row.icon,
    logo: row.logo,
    category: row.category,
    tagline: row.tagline,
    short_description: row.short_description,
    services: row.services,
    rating: Number(row.rating),
    rating_count: row.rating_count,
    subscriber_count: 0, // overridden by caller with live count
    publisher_name: row.publisher_name,
    pricing_model: row.pricing_model,
    from_price: row.from_price_amount !== undefined && row.from_price_amount !== null
      ? money(row.from_price_amount, row.from_price_currency ?? 'USDC')
      : null,
    status: row.status,
    created_at: row.created_at.toISOString(),
  }
}

export interface PlanRow {
  plan_id: string
  name: string
  billing_interval: string
  base_price_amount: string
  base_price_currency: string
  usage_price_amount: string | null
  usage_unit: string | null
  description: string | null
}

export function serializePlan(row: PlanRow): object {
  return {
    plan_id: row.plan_id,
    name: row.name,
    billing_interval: row.billing_interval,
    base_price: money(row.base_price_amount, row.base_price_currency),
    usage_price: row.usage_price_amount !== null ? money(row.usage_price_amount, row.base_price_currency) : null,
    usage_unit: row.usage_unit,
    description: row.description,
  }
}
