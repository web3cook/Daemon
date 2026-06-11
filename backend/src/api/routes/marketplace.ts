import { Router } from 'express'
import { query } from '../../db/pool.js'
import { ok, fail, money } from '../response.js'
import { newInvocationId } from '../ids.js'
import { serializeAgentCard, serializePlan, type AgentRow, type PlanRow } from '../serializers.js'

export const marketplaceRouter = Router()

const VALID_CATEGORIES = new Set(['finance', 'productivity', 'career', 'engineering', 'research', 'other'])
const VALID_SORTS = new Set(['popular', 'rating', 'price_asc', 'price_desc', 'newest'])

function sortClause(sort: string): string {
  switch (sort) {
    case 'rating':     return 'a.rating DESC'
    case 'price_asc':  return 'from_price_amount ASC NULLS LAST'
    case 'price_desc': return 'from_price_amount DESC NULLS LAST'
    case 'newest':     return 'a.created_at DESC'
    case 'popular':
    default:           return 'subscriber_count DESC'
  }
}

// GET /agents
marketplaceRouter.get('/', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined
  const search   = typeof req.query.search === 'string' ? req.query.search : undefined
  const sort     = typeof req.query.sort === 'string' && VALID_SORTS.has(req.query.sort) ? req.query.sort : 'popular'
  const page     = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20')) || 20))
  const offset   = (page - 1) * limit

  if (category !== undefined && !VALID_CATEGORIES.has(category)) {
    fail(res, 404, 'Agents not found', {})
    return
  }

  const conditions: string[] = [`a.status = 'live'`]
  const params: unknown[] = []

  if (category) {
    params.push(category)
    conditions.push(`a.category = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(a.name ILIKE $${params.length} OR a.short_description ILIKE $${params.length})`)
  }

  const where = conditions.join(' AND ')

  const baseFrom = `
    FROM agents a
    LEFT JOIN (
      SELECT agent_id, COUNT(*)::int AS live_subs
      FROM subscriptions WHERE status = 'active' GROUP BY agent_id
    ) sub ON sub.agent_id = a.agent_id
    LEFT JOIN (
      SELECT DISTINCT ON (agent_id) agent_id, base_price_amount AS from_price_amount, base_price_currency AS from_price_currency
      FROM plans ORDER BY agent_id, base_price_amount ASC
    ) p ON p.agent_id = a.agent_id
    WHERE ${where}
  `

  const countRes = await query<{ count: string }>(`SELECT COUNT(*) ${baseFrom}`, params)
  const totalItems = parseInt(countRes.rows[0]!.count)

  if (totalItems === 0) {
    fail(res, 404, 'Agents not found', {})
    return
  }

  const rowsRes = await query<AgentRow & { live_subs: number | null; from_price_amount: string | null; from_price_currency: string | null }>(
    `SELECT a.*,
            COALESCE(sub.live_subs, 0) AS live_subs,
            (a.base_subscriber_count + COALESCE(sub.live_subs, 0)) AS subscriber_count,
            p.from_price_amount, p.from_price_currency
     ${baseFrom}
     ORDER BY ${sortClause(sort)}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )

  const agents = rowsRes.rows.map(row => {
    const card = serializeAgentCard(row) as Record<string, unknown>
    card['subscriber_count'] = row.base_subscriber_count + (row.live_subs ?? 0)
    return card
  })

  ok(res, 200, 'Data fetched successfully', {
    agents,
    pagination: { page, limit, total_items: totalItems, total_pages: Math.ceil(totalItems / limit) },
  })
})

// GET /agents/:agent_id
marketplaceRouter.get('/:agent_id', async (req, res) => {
  const { agent_id } = req.params

  const agentRes = await query<AgentRow & { live_subs: number | null }>(
    `SELECT a.*, COALESCE(sub.live_subs, 0) AS live_subs
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     WHERE a.agent_id = $1`,
    [agent_id],
  )

  const agent = agentRes.rows[0]
  if (!agent) {
    fail(res, 404, 'Agent not found', {})
    return
  }

  const plansRes = await query<PlanRow>(
    'SELECT * FROM plans WHERE agent_id = $1 ORDER BY sort_order ASC',
    [agent_id],
  )

  const plans = plansRes.rows.map(serializePlan)
  const fromPlan = plansRes.rows[0]

  const card = serializeAgentCard(agent) as Record<string, unknown>
  card['subscriber_count'] = agent.base_subscriber_count + (agent.live_subs ?? 0)
  card['from_price'] = fromPlan ? money(fromPlan.base_price_amount, fromPlan.base_price_currency) : null
  card['description'] = agent.description ?? agent.short_description
  card['plans'] = plans

  ok(res, 200, 'Data fetched successfully', { agent: card })
})

// POST /agents/:agent_id/invoke — x402 one-time/usage flow stub (§7, phase 2)
marketplaceRouter.post('/:agent_id/invoke', async (req, res) => {
  const { agent_id } = req.params
  const paymentHeader = req.header('X-Payment')

  const agentRes = await query<{ agent_id: string }>('SELECT agent_id FROM agents WHERE agent_id = $1', [agent_id])
  if (agentRes.rows.length === 0) {
    fail(res, 404, 'Agent not found', {})
    return
  }

  if (!paymentHeader) {
    fail(res, 402, 'Payment required to invoke this service', {
      payment_requirements: {
        scheme: 'exact',
        network: 'stellar',
        amount: money('0.50'),
        pay_to: 'GDAEMON…XLM',
        memo: newInvocationId(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    })
    return
  }

  ok(res, 200, 'Service invoked', {
    invocation_id: newInvocationId(),
    status: 'completed',
    output: {},
    receipt: { tx_hash: 'stellar:stub', settled_at: new Date().toISOString() },
  })
})
