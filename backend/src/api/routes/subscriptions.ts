import { Router } from 'express'
import { isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money } from '../response.js'
import { findOrCreateUser } from '../userdb.js'
import { newSubscriptionId, newInvoiceId } from '../ids.js'
import { serializeSubscription, type SubscriptionJoinRow } from '../serializers.js'
import { config } from '../../config.js'
import { chainName } from '../chain.js'

export const subscriptionsRouter = Router()

const SUBSCRIPTION_SELECT = `
  SELECT s.id, s.status, s.usage_count,
         s.last_payment_amount, s.last_payment_currency, s.last_payment_time,
         s.next_payment_amount, s.next_payment_currency, s.next_payment_time,
         s.started_at, s.cancelled_at,
         a.agent_id, a.name AS agent_name, a.logo AS agent_logo, a.usage_label,
         p.plan_id, p.name AS plan_name, p.billing_interval
  FROM subscriptions s
  JOIN agents a ON a.agent_id = s.agent_id
  JOIN plans p ON p.plan_id = s.plan_id
`

function nextPaymentDate(billingInterval: string, from: Date): Date | null {
  const d = new Date(from)
  switch (billingInterval) {
    case 'weekly':
      d.setDate(d.getDate() + 7)
      return d
    case 'monthly':
      d.setMonth(d.getMonth() + 1)
      return d
    case 'one_time':
    default:
      return null
  }
}

// POST /subscriptions
subscriptionsRouter.post('/', async (req, res) => {
  const { user_address, agent_id, plan_id } = req.body as { user_address?: string; agent_id?: string; plan_id?: string }

  if (!user_address || !isAddress(user_address, { strict: false }) || !agent_id || !plan_id) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', agent_id: 'required', plan_id: 'required' } })
    return
  }

  const planRes = await query<{
    plan_id: string
    agent_id: string
    name: string
    billing_interval: string
    base_price_amount: string
    base_price_currency: string
  }>(
    `SELECT p.plan_id, p.agent_id, p.name, p.billing_interval, p.base_price_amount, p.base_price_currency
     FROM plans p WHERE p.plan_id = $1 AND p.agent_id = $2`,
    [plan_id, agent_id],
  )
  const plan = planRes.rows[0]

  if (!plan) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { plan_id: 'unknown plan for this agent' } })
    return
  }

  const agentRes = await query<{ agent_id: string; name: string; status: string }>(
    'SELECT agent_id, name, status FROM agents WHERE agent_id = $1',
    [agent_id],
  )
  const agent = agentRes.rows[0]
  if (!agent || agent.status !== 'live') {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { agent_id: 'agent not available' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const existing = await query(
    `SELECT 1 FROM subscriptions WHERE user_id = $1 AND agent_id = $2 AND status = 'active'`,
    [user.user_id, agent_id],
  )
  if (existing.rows.length > 0) {
    fail(res, 409, 'Already subscribed to this agent', {})
    return
  }

  const subId = newSubscriptionId()
  const now = new Date()
  const next = nextPaymentDate(plan.billing_interval, now)

  await query(
    `INSERT INTO subscriptions (id, user_id, agent_id, plan_id, status, next_payment_amount, next_payment_currency, next_payment_time, started_at)
     VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8)`,
    [subId, user.user_id, agent_id, plan_id, plan.base_price_amount, plan.base_price_currency, next, now],
  )

  await query(
    `INSERT INTO invoices (invoice_id, user_id, subscription_id, description, amount, currency, status, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [newInvoiceId(), user.user_id, subId, `${agent.name} · ${plan.name}`, plan.base_price_amount, plan.base_price_currency, now],
  )

  const subRow = await query<SubscriptionJoinRow>(`${SUBSCRIPTION_SELECT} WHERE s.id = $1`, [subId])

  ok(res, 201, 'Subscription created', {
    subscription: serializeSubscription(subRow.rows[0]!),
    payment: {
      contract_address: config.subscriptionsAddr,
      network: chainName,
      amount: money(plan.base_price_amount, plan.base_price_currency),
      memo: subId,
    },
  })
})

// POST /subscriptions/:subscription_id/cancel
subscriptionsRouter.post('/:subscription_id/cancel', async (req, res) => {
  const { subscription_id } = req.params
  const { user_address } = req.body as { user_address?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const subRes = await query<{ id: string; status: string }>(
    'SELECT id, status FROM subscriptions WHERE id = $1 AND user_id = $2',
    [subscription_id, user.user_id],
  )
  if (subRes.rows.length === 0) {
    fail(res, 404, 'Subscription not found', {})
    return
  }

  await query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
    [subscription_id],
  )

  const updated = await query<SubscriptionJoinRow>(`${SUBSCRIPTION_SELECT} WHERE s.id = $1`, [subscription_id])
  const sub = updated.rows[0]!

  const cancelDate = sub.next_payment_time ?? new Date()
  const formatted = cancelDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  ok(res, 200, `Subscription cancelled — active until ${formatted}`, {
    subscription: serializeSubscription(sub),
  })
})
