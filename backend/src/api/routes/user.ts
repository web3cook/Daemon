import { Router } from 'express'
import { isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money } from '../response.js'
import { findUserByAddress, findOrCreateUser, serializeUser } from '../userdb.js'
import { serializeSubscription, type SubscriptionJoinRow } from '../serializers.js'
import { getUsdcBalance } from '../chain.js'

export const userRouter = Router()

const VALID_STATUSES = new Set(['active', 'cancelled', 'expired', 'past_due'])

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

// POST /user/onboard
userRouter.post('/onboard', async (req, res) => {
  const { user_address, handle, role } = req.body as { user_address?: string; handle?: string; role?: string }

  if (!user_address || !isAddress(user_address, { strict: false }) || !handle || !role) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', handle: 'required', role: 'required' } })
    return
  }

  if (role !== 'subscriber' && role !== 'creator') {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { role: 'must be subscriber or creator' } })
    return
  }

  const handleTaken = await query('SELECT 1 FROM users WHERE handle = $1 AND user_address != $2', [handle, user_address])
  if (handleTaken.rows.length > 0) {
    fail(res, 409, 'Handle already taken', {})
    return
  }

  const user = await findOrCreateUser(user_address)
  const roles = Array.from(new Set([...user.roles, role]))

  const updated = await query<typeof user>(
    'UPDATE users SET handle = $2, roles = $3 WHERE user_address = $1 RETURNING *',
    [user_address, handle, roles],
  )

  ok(res, 201, 'User onboarded', { user: serializeUser(updated.rows[0]!) })
})

// POST /user/subscriptions
userRouter.post('/subscriptions', async (req, res) => {
  const { user_address, status } = req.body as { user_address?: string; status?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const filterStatus = status ?? 'active'
  if (!VALID_STATUSES.has(filterStatus)) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { status: 'invalid subscription_status' } })
    return
  }

  const user = await findUserByAddress(user_address)
  if (!user) {
    fail(res, 404, 'No subscriptions found', {})
    return
  }

  const rows = await query<SubscriptionJoinRow>(
    `${SUBSCRIPTION_SELECT} WHERE s.user_id = $1 AND s.status = $2 ORDER BY s.started_at DESC`,
    [user.user_id, filterStatus],
  )

  if (rows.rows.length === 0) {
    fail(res, 404, 'No subscriptions found', {})
    return
  }

  const subscriptions = rows.rows.map(serializeSubscription)

  const monthlyTotal = rows.rows
    .filter(r => r.status === 'active' && r.billing_interval === 'monthly')
    .reduce((sum, r) => sum + Number(r.next_payment_amount ?? r.last_payment_amount ?? 0), 0)

  ok(res, 200, 'Data fetched successfully', {
    subscriptions,
    summary: {
      active_count: rows.rows.filter(r => r.status === 'active').length,
      monthly_total: money(monthlyTotal),
    },
  })
})

// POST /user/billing
userRouter.post('/billing', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)
  const balance = await getUsdcBalance(user_address)

  const nextRows = await query<{ amount: string; currency: string; next_payment_time: Date }>(
    `SELECT next_payment_amount AS amount, next_payment_currency AS currency, next_payment_time
     FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND next_payment_time IS NOT NULL
     ORDER BY next_payment_time ASC LIMIT 1`,
    [user.user_id],
  )
  const next = nextRows.rows[0]

  ok(res, 200, 'Data fetched successfully', {
    user_address,
    balance: money(balance),
    next_charge: next
      ? { amount: money(next.amount, next.currency), charge_at: next.next_payment_time.toISOString() }
      : null,
  })
})

// POST /user/invoices
userRouter.post('/invoices', async (req, res) => {
  const { user_address, page: pageRaw, limit: limitRaw } = req.body as { user_address?: string; page?: number; limit?: number }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const page  = Math.max(1, Number(pageRaw) || 1)
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20))
  const offset = (page - 1) * limit

  const user = await findUserByAddress(user_address)
  if (!user) {
    ok(res, 200, 'Data fetched successfully', { invoices: [], pagination: { page, limit, total_items: 0, total_pages: 0 } })
    return
  }

  const countRes = await query<{ count: string }>('SELECT COUNT(*) FROM invoices WHERE user_id = $1', [user.user_id])
  const totalItems = parseInt(countRes.rows[0]!.count)

  const rows = await query<{
    invoice_id: string
    description: string | null
    amount: string
    currency: string
    status: string
    tx_hash: string | null
    issued_at: Date
    paid_at: Date | null
  }>(
    `SELECT invoice_id, description, amount, currency, status, tx_hash, issued_at, paid_at
     FROM invoices WHERE user_id = $1 ORDER BY issued_at DESC LIMIT $2 OFFSET $3`,
    [user.user_id, limit, offset],
  )

  const invoices = rows.rows.map(r => ({
    invoice_id: r.invoice_id,
    description: r.description,
    amount: money(r.amount, r.currency),
    status: r.status,
    tx_hash: r.tx_hash,
    issued_at: r.issued_at.toISOString(),
    paid_at: r.paid_at ? r.paid_at.toISOString() : null,
  }))

  ok(res, 200, 'Data fetched successfully', {
    invoices,
    pagination: { page, limit, total_items: totalItems, total_pages: Math.ceil(totalItems / limit) },
  })
})
