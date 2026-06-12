import { Router } from 'express'
import { isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money } from '../response.js'
import { findOrCreateUser } from '../userdb.js'
import { newAgentId, newPlanId } from '../ids.js'
import { serializeAgentCard, serializePlan, type AgentRow, type PlanRow } from '../serializers.js'

export const creatorRouter = Router()

const VALID_CATEGORIES = new Set(['finance', 'productivity', 'career', 'engineering', 'research', 'other'])
const VALID_PRICING_MODELS = new Set(['flat', 'usage', 'hybrid'])
const VALID_BILLING_INTERVALS = new Set(['one_time', 'weekly', 'monthly'])

const PLATFORM_FEE = 0.10

interface PlanInput {
  name?: string
  billing_interval?: string
  base_price?: { amount?: string | number; currency?: string }
  usage_price?: { amount?: string | number; currency?: string } | null
  usage_unit?: string | null
  description?: string
}

function validateAgentPayload(body: {
  name?: string
  category?: string
  short_description?: string
  services?: string[]
  pricing_model?: string
  plans?: PlanInput[]
}, requirePlans: boolean): Record<string, string> | null {
  const errors: Record<string, string> = {}

  if (!body.name) errors['name'] = 'required'
  if (!body.category || !VALID_CATEGORIES.has(body.category)) errors['category'] = 'must be a valid agent_category'
  if (!body.short_description) errors['short_description'] = 'required'
  if (!Array.isArray(body.services) || body.services.length === 0) errors['services'] = 'must be a non-empty array'
  if (!body.pricing_model || !VALID_PRICING_MODELS.has(body.pricing_model)) errors['pricing_model'] = 'must be flat, usage, or hybrid'

  if (requirePlans || body.plans !== undefined) {
    if (!Array.isArray(body.plans) || body.plans.length === 0) {
      errors['plans'] = 'must be a non-empty array'
    } else {
      body.plans.forEach((plan, i) => {
        if (!plan.name) errors[`plans[${i}].name`] = 'required'
        if (!plan.billing_interval || !VALID_BILLING_INTERVALS.has(plan.billing_interval)) errors[`plans[${i}].billing_interval`] = 'must be a valid billing_interval'
        const amount = Number(plan.base_price?.amount)
        if (!plan.base_price || !(amount > 0)) errors[`plans[${i}].base_price.amount`] = 'must be > 0'
      })
    }
  }

  return Object.keys(errors).length > 0 ? errors : null
}

async function loadAgentDetail(agentId: string): Promise<object | null> {
  const agentRes = await query<AgentRow & { live_subs: number | null }>(
    `SELECT a.*, COALESCE(sub.live_subs, 0) AS live_subs
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     WHERE a.agent_id = $1`,
    [agentId],
  )
  const agent = agentRes.rows[0]
  if (!agent) return null

  const plansRes = await query<PlanRow>('SELECT * FROM plans WHERE agent_id = $1 ORDER BY sort_order ASC', [agentId])
  const plans = plansRes.rows.map(serializePlan)
  const fromPlan = plansRes.rows[0]

  const card = serializeAgentCard(agent) as Record<string, unknown>
  card['subscriber_count'] = agent.base_subscriber_count + (agent.live_subs ?? 0)
  card['from_price'] = fromPlan ? money(fromPlan.base_price_amount, fromPlan.base_price_currency) : null
  card['description'] = agent.description ?? agent.short_description
  card['plans'] = plans
  return card
}

// POST /creator/agents/list
creatorRouter.post('/agents/list', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }
  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const rows = await query<AgentRow & { live_subs: number | null; mrr: string | null }>(
    `SELECT a.*, COALESCE(sub.live_subs, 0) AS live_subs, COALESCE(mrr.total, 0) AS mrr
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     LEFT JOIN (
       SELECT s.agent_id, SUM(p.base_price_amount) AS total
       FROM subscriptions s
       JOIN plans p ON p.plan_id = s.plan_id
       WHERE s.status = 'active' AND p.billing_interval = 'monthly'
       GROUP BY s.agent_id
     ) mrr ON mrr.agent_id = a.agent_id
     WHERE a.publisher_user_id = $1
     ORDER BY a.created_at DESC`,
    [user.user_id],
  )

  const agents = rows.rows.map(row => ({
    agent_id: row.agent_id,
    name: row.name,
    icon: row.icon,
    logo: row.logo,
    category: row.category,
    tagline: row.tagline,
    status: row.status,
    subscriber_count: row.base_subscriber_count + (row.live_subs ?? 0),
    monthly_recurring_revenue: money(Number(row.mrr ?? 0) * (1 - PLATFORM_FEE)),
    created_at: row.created_at.toISOString(),
  }))

  ok(res, 200, 'Data fetched successfully', { agents })
})

// POST /creator/agents/register
creatorRouter.post('/agents/register', async (req, res) => {
  const body = req.body as {
    user_address?: string
    name?: string
    category?: string
    short_description?: string
    services?: string[]
    pricing_model?: string
    plans?: PlanInput[]
  }

  if (!body.user_address || !isAddress(body.user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const fieldErrors = validateAgentPayload(body, true)
  if (fieldErrors) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: fieldErrors })
    return
  }

  const user = await findOrCreateUser(body.user_address)
  const agentId = newAgentId()
  const slug = `${body.name!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${agentId.slice(-6).toLowerCase()}`

  await query(
    `INSERT INTO agents (agent_id, slug, name, icon, logo, category, tagline, short_description, description,
                          services, rating, rating_count, base_subscriber_count, publisher_name, publisher_user_id,
                          pricing_model, status, onchain, usage_label)
     VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$6,$7,0,0,0,$8,$9,$10,'live',false,NULL)`,
    [
      agentId, slug, body.name, body.category, body.services![0] ?? '', body.short_description,
      body.services, user.handle ?? body.user_address, user.user_id, body.pricing_model,
    ],
  )

  let sortOrder = 0
  for (const plan of body.plans!) {
    await query(
      `INSERT INTO plans (plan_id, agent_id, name, billing_interval, base_price_amount, base_price_currency,
                           usage_price_amount, usage_unit, description, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        newPlanId(), agentId, plan.name, plan.billing_interval,
        plan.base_price!.amount, plan.base_price!.currency ?? 'USDC',
        plan.usage_price?.amount ?? null, plan.usage_unit ?? null, plan.description ?? null, sortOrder,
      ],
    )
    sortOrder++
  }

  const detail = await loadAgentDetail(agentId)
  ok(res, 201, 'Agent registered and live in the marketplace', { agent: detail })
})

// POST /creator/agents/update
creatorRouter.post('/agents/update', async (req, res) => {
  const body = req.body as {
    user_address?: string
    agent_id?: string
    name?: string
    category?: string
    short_description?: string
    services?: string[]
    pricing_model?: string
    plans?: PlanInput[]
    status?: string
  }

  if (!body.user_address || !isAddress(body.user_address, { strict: false }) || !body.agent_id) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', agent_id: 'required' } })
    return
  }

  const user = await findOrCreateUser(body.user_address)

  const agentRes = await query<{ agent_id: string; publisher_user_id: string | null }>(
    'SELECT agent_id, publisher_user_id FROM agents WHERE agent_id = $1',
    [body.agent_id],
  )
  const agent = agentRes.rows[0]
  if (!agent) {
    fail(res, 404, 'Agent not found', {})
    return
  }
  if (agent.publisher_user_id !== user.user_id) {
    fail(res, 403, 'You do not own this agent', {})
    return
  }

  const fieldErrors = validateAgentPayload(body, false)
  if (fieldErrors) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: fieldErrors })
    return
  }

  if (body.status !== undefined && body.status !== 'live' && body.status !== 'paused') {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { status: 'must be live or paused' } })
    return
  }

  const sets: string[] = []
  const params: unknown[] = []
  const addSet = (col: string, val: unknown): void => {
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }

  if (body.name !== undefined) addSet('name', body.name)
  if (body.category !== undefined) addSet('category', body.category)
  if (body.short_description !== undefined) addSet('short_description', body.short_description)
  if (body.services !== undefined) addSet('services', body.services)
  if (body.pricing_model !== undefined) addSet('pricing_model', body.pricing_model)
  if (body.status !== undefined) addSet('status', body.status)

  if (sets.length > 0) {
    params.push(body.agent_id)
    await query(`UPDATE agents SET ${sets.join(', ')} WHERE agent_id = $${params.length}`, params)
  }

  if (body.plans !== undefined) {
    await query('DELETE FROM plans WHERE agent_id = $1', [body.agent_id])
    let sortOrder = 0
    for (const plan of body.plans) {
      await query(
        `INSERT INTO plans (plan_id, agent_id, name, billing_interval, base_price_amount, base_price_currency,
                             usage_price_amount, usage_unit, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          newPlanId(), body.agent_id, plan.name, plan.billing_interval,
          plan.base_price!.amount, plan.base_price!.currency ?? 'USDC',
          plan.usage_price?.amount ?? null, plan.usage_unit ?? null, plan.description ?? null, sortOrder,
        ],
      )
      sortOrder++
    }
  }

  const detail = await loadAgentDetail(body.agent_id)
  ok(res, 200, 'Agent updated', { agent: detail })
})

// POST /creator/earnings
creatorRouter.post('/earnings', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }
  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const agentsRes = await query<{ agent_id: string; name: string; base_subscriber_count: number; live_subs: number | null; mrr: string | null }>(
    `SELECT a.agent_id, a.name, a.base_subscriber_count, COALESCE(sub.live_subs, 0) AS live_subs, COALESCE(mrr.total, 0) AS mrr
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     LEFT JOIN (
       SELECT s.agent_id, SUM(p.base_price_amount) AS total
       FROM subscriptions s
       JOIN plans p ON p.plan_id = s.plan_id
       WHERE s.status = 'active' AND p.billing_interval = 'monthly'
       GROUP BY s.agent_id
     ) mrr ON mrr.agent_id = a.agent_id
     WHERE a.publisher_user_id = $1`,
    [user.user_id],
  )

  const agentIds = agentsRes.rows.map(r => r.agent_id)
  const grossMrr = agentsRes.rows.reduce((sum, r) => sum + Number(r.mrr ?? 0), 0)
  const netMrr = grossMrr * (1 - PLATFORM_FEE)
  const activeSubscribers = agentsRes.rows.reduce((sum, r) => sum + r.base_subscriber_count + (r.live_subs ?? 0), 0)

  let lifetimeRevenue = 0
  if (agentIds.length > 0) {
    const lifetimeRes = await query<{ total: string | null }>(
      `SELECT SUM(i.amount) AS total
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       WHERE s.agent_id = ANY($1) AND i.status = 'paid'`,
      [agentIds],
    )
    lifetimeRevenue = Number(lifetimeRes.rows[0]?.total ?? 0) * (1 - PLATFORM_FEE)
  }

  // Trailing 8 months, oldest first — zero-filled where no invoice data exists yet.
  const revenueByMonth: { month: string; net: object }[] = []
  const now = new Date()
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    let net = 0
    if (agentIds.length > 0) {
      const monthRes = await query<{ total: string | null }>(
        `SELECT SUM(i.amount) AS total
         FROM invoices i
         JOIN subscriptions s ON s.id = i.subscription_id
         WHERE s.agent_id = ANY($1) AND i.status = 'paid'
           AND date_trunc('month', i.paid_at) = $2`,
        [agentIds, d],
      )
      net = Number(monthRes.rows[0]?.total ?? 0) * (1 - PLATFORM_FEE)
    }
    revenueByMonth.push({ month: monthKey, net: money(net) })
  }

  let payouts: object[] = []
  if (agentIds.length > 0) {
    const payoutsRes = await query<{ payout_id: string; amount: string; currency: string; status: string; tx_hash: string | null; payout_at: Date }>(
      `SELECT payout_id, amount, currency, status, tx_hash, payout_at
       FROM payouts WHERE agent_id = ANY($1) ORDER BY payout_at DESC LIMIT 12`,
      [agentIds],
    )
    payouts = payoutsRes.rows.map(p => ({
      payout_id: p.payout_id,
      amount: money(p.amount, p.currency),
      status: p.status,
      tx_hash: p.tx_hash,
      payout_at: p.payout_at.toISOString(),
    }))
  }

  const earningsByAgent = agentsRes.rows.map(r => ({
    agent_id: r.agent_id,
    agent_name: r.name,
    subscriber_count: r.base_subscriber_count + (r.live_subs ?? 0),
    monthly_recurring_revenue: money(Number(r.mrr ?? 0) * (1 - PLATFORM_FEE)),
  }))

  const nextPayoutDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  ok(res, 200, 'Data fetched successfully', {
    stats: {
      net_monthly_recurring_revenue: money(netMrr),
      mrr_change_percent: 0,
      active_subscribers: activeSubscribers,
      subscriber_change: 0,
      next_payout: {
        amount: money(netMrr),
        payout_at: nextPayoutDate.toISOString(),
      },
      lifetime_revenue: money(lifetimeRevenue),
    },
    revenue_by_month: revenueByMonth,
    payouts,
    earnings_by_agent: earningsByAgent,
  })
})
