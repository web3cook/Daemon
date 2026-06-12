import { ulid } from 'ulid'
import { pool, query } from './pool.js'
import { logger } from '../logger.js'

interface SeedPlan {
  name: string
  billing_interval: 'one_time' | 'weekly' | 'monthly'
  base_price: number
  usage_price?: number
  usage_unit?: string
  description: string
}

interface SeedAgent {
  slug: string
  name: string
  category: string
  tagline: string
  short_description: string
  description: string
  services: string[]
  rating: number
  rating_count: number
  base_subscriber_count: number
  publisher_name: string
  pricing_model: 'flat' | 'usage' | 'hybrid'
  onchain: boolean
  usage_label: string
  plans: SeedPlan[]
  erc8004_agent_id?: number
  agent_eoa?: string
  trust_score?: number
}

const AGENT_EOA = '0xF96dD19c97906bEFF9f3A94002ae9bB7b4c0b034'

const CDN = 'https://cdn.daemonagents.com/agents'

const AGENTS: SeedAgent[] = [
  {
    slug: 'pulse',
    name: 'Pulse',
    category: 'finance',
    tagline: 'dca-agent',
    short_description:
      'Dollar-cost averages into your portfolio on a schedule you set — no charts, no stress.',
    description:
      'Pulse executes a disciplined dollar-cost averaging strategy across the assets you pick. Set a schedule and a budget; it buys through your linked wallet on Arbitrum, rebalances drift, and sends a plain-language summary after every run. Pulse is an ERC-8004 registered autonomous agent — every execution is gated by an on-chain trust score and pays for its own price/routing data via x402.',
    services: ['auto-dca', 'rebalance', 'alerts'],
    rating: 4.8,
    rating_count: 312,
    base_subscriber_count: 1200,
    publisher_name: 'Meridian Labs',
    pricing_model: 'flat',
    onchain: true,
    usage_label: 'buys executed this month',
    plans: [
      { name: 'starter', billing_interval: 'monthly', base_price: 19, description: '1 portfolio · weekly buys · email summaries' },
      { name: 'pro', billing_interval: 'monthly', base_price: 49, description: '5 portfolios · daily buys · auto-rebalancing · priority runs' },
    ],
    erc8004_agent_id: 1,
    agent_eoa: AGENT_EOA,
    trust_score: 80,
  },
  {
    slug: 'tidy',
    name: 'Tidy',
    category: 'productivity',
    tagline: 'organiser-agent',
    short_description: 'Keeps your inbox, calendar and task list in order — triages, schedules and reminds.',
    description:
      'Tidy connects to your email and calendar, triages what arrives, schedules what needs a slot, and keeps a running task list it actually maintains. Every morning you get a one-screen brief of what it did and what needs you.',
    services: ['inbox-triage', 'scheduling', 'tasks'],
    rating: 4.7,
    rating_count: 980,
    base_subscriber_count: 3400,
    publisher_name: 'Northbeam',
    pricing_model: 'flat',
    onchain: false,
    usage_label: 'emails triaged this month',
    plans: [
      { name: 'standard', billing_interval: 'monthly', base_price: 12, description: '1 inbox + 1 calendar · daily brief' },
      { name: 'plus', billing_interval: 'monthly', base_price: 25, description: '3 inboxes · shared calendars · family/team tasks' },
    ],
  },
  {
    slug: 'pathfinder',
    name: 'Pathfinder',
    category: 'career',
    tagline: 'jobfinder-agent',
    short_description: 'Hunts job boards overnight, tailors your CV per role and tracks every application.',
    description:
      'Pathfinder scans boards and company pages overnight against your profile, ranks matches, tailors your CV and cover letter per role, and submits with your approval — then tracks every application through to reply.',
    services: ['job-match', 'cv-tailor', 'tracking'],
    rating: 4.9,
    rating_count: 410,
    base_subscriber_count: 860,
    publisher_name: 'Coldfront',
    pricing_model: 'hybrid',
    onchain: false,
    usage_label: 'applications submitted',
    plans: [
      { name: 'searcher', billing_interval: 'monthly', base_price: 24, usage_price: 0.50, usage_unit: 'application', description: 'Unlimited matching · pay per tailored application' },
      { name: 'all-in', billing_interval: 'monthly', base_price: 59, description: 'Everything included · unlimited applications' },
    ],
  },
  {
    slug: 'clerk',
    name: 'Clerk',
    category: 'finance',
    tagline: 'bookkeeping-agent',
    short_description: 'Categorizes transactions, reconciles monthly and hands your accountant clean books.',
    description:
      'Clerk watches your business accounts, categorizes every transaction against your chart of accounts, reconciles at month end, and exports accountant-ready books.',
    services: ['categorize', 'reconcile', 'exports'],
    rating: 4.6,
    rating_count: 305,
    base_subscriber_count: 640,
    publisher_name: 'Quietbooks',
    pricing_model: 'usage',
    onchain: true,
    usage_label: 'transactions processed',
    plans: [
      { name: 'metered', billing_interval: 'monthly', base_price: 9, usage_price: 0.04, usage_unit: 'transaction', description: 'Pay for what it processes · monthly close included' },
      { name: 'flat', billing_interval: 'monthly', base_price: 79, description: 'Unlimited transactions · quarterly review call' },
    ],
    erc8004_agent_id: 2,
    agent_eoa: AGENT_EOA,
    trust_score: 80,
  },
  {
    slug: 'scribe',
    name: 'Scribe',
    category: 'productivity',
    tagline: 'notes-agent',
    short_description: 'Joins your meetings, writes decisions-first notes and chases the action items.',
    description:
      'Scribe sits in on your calls, produces decisions-first notes within minutes, and follows up on action items with owners until they\'re done or escalated.',
    services: ['meeting-notes', 'action-items', 'follow-ups'],
    rating: 4.7,
    rating_count: 740,
    base_subscriber_count: 2100,
    publisher_name: 'Stanza',
    pricing_model: 'flat',
    onchain: false,
    usage_label: 'meetings covered',
    plans: [
      { name: 'solo', billing_interval: 'monthly', base_price: 15, description: '10 meetings/mo · notes + action items' },
      { name: 'team', billing_interval: 'monthly', base_price: 45, description: 'Unlimited meetings · shared workspace · integrations' },
    ],
  },
  {
    slug: 'watchdog',
    name: 'Watchdog',
    category: 'engineering',
    tagline: 'monitor-agent',
    short_description: 'Watches your sites and APIs, fixes routine incidents and writes the post-mortem.',
    description:
      'Watchdog monitors uptime and performance, handles routine remediations like restarts and rollbacks autonomously, and posts a clear post-mortem to your channel after every incident.',
    services: ['uptime', 'auto-fix', 'post-mortems'],
    rating: 4.8,
    rating_count: 312,
    base_subscriber_count: 990,
    publisher_name: 'Stackwatch',
    pricing_model: 'flat',
    onchain: false,
    usage_label: 'uptime · auto-fixes',
    plans: [
      { name: 'basic', billing_interval: 'monthly', base_price: 29, description: '5 endpoints · auto-restart · status page' },
      { name: 'fleet', billing_interval: 'monthly', base_price: 89, description: '50 endpoints · rollbacks · on-call escalation' },
    ],
  },
]

async function main(): Promise<void> {
  for (const agent of AGENTS) {
    const existing = await query<{ agent_id: string }>('SELECT agent_id FROM agents WHERE slug = $1', [agent.slug])

    let agentId: string
    if (existing.rows.length > 0) {
      agentId = existing.rows[0]!.agent_id
      logger.info({ slug: agent.slug, agentId }, 'agent already seeded — updating')
      await query(
        `UPDATE agents SET name=$2, icon=$3, logo=$4, category=$5, tagline=$6, short_description=$7,
                description=$8, services=$9, rating=$10, rating_count=$11, publisher_name=$12,
                pricing_model=$13, onchain=$14, usage_label=$15, base_subscriber_count=$16,
                erc8004_agent_id=$17, agent_eoa=$18, trust_score=$19
         WHERE agent_id=$1`,
        [
          agentId, agent.name, `${CDN}/${agent.slug}/icon.png`, `${CDN}/${agent.slug}/logo.png`,
          agent.category, agent.tagline, agent.short_description, agent.description, agent.services,
          agent.rating, agent.rating_count, agent.publisher_name, agent.pricing_model, agent.onchain,
          agent.usage_label, agent.base_subscriber_count,
          agent.erc8004_agent_id ?? null, agent.agent_eoa ?? null, agent.trust_score ?? null,
        ],
      )
    } else {
      agentId = `agt_${ulid()}`
      await query(
        `INSERT INTO agents (agent_id, slug, name, icon, logo, category, tagline, short_description,
                              description, services, rating, rating_count, publisher_name,
                              pricing_model, status, onchain, usage_label, base_subscriber_count,
                              erc8004_agent_id, agent_eoa, trust_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'live',$15,$16,$17,$18,$19,$20)`,
        [
          agentId, agent.slug, agent.name, `${CDN}/${agent.slug}/icon.png`, `${CDN}/${agent.slug}/logo.png`,
          agent.category, agent.tagline, agent.short_description, agent.description, agent.services,
          agent.rating, agent.rating_count, agent.publisher_name, agent.pricing_model, agent.onchain,
          agent.usage_label, agent.base_subscriber_count,
          agent.erc8004_agent_id ?? null, agent.agent_eoa ?? null, agent.trust_score ?? null,
        ],
      )
      logger.info({ slug: agent.slug, agentId }, 'agent seeded')
    }

    let sortOrder = 0
    for (const plan of agent.plans) {
      const planId = `pln_${ulid()}`
      await query(
        `INSERT INTO plans (plan_id, agent_id, name, billing_interval, base_price_amount, base_price_currency,
                             usage_price_amount, usage_unit, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,'USDC',$6,$7,$8,$9)
         ON CONFLICT (agent_id, name) DO UPDATE SET
           billing_interval = EXCLUDED.billing_interval,
           base_price_amount = EXCLUDED.base_price_amount,
           usage_price_amount = EXCLUDED.usage_price_amount,
           usage_unit = EXCLUDED.usage_unit,
           description = EXCLUDED.description,
           sort_order = EXCLUDED.sort_order`,
        [planId, agentId, plan.name, plan.billing_interval, plan.base_price, plan.usage_price ?? null, plan.usage_unit ?? null, plan.description, sortOrder],
      )
      sortOrder++
    }
  }

  logger.info('seed complete')
  await pool.end()
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'seed failed')
  process.exit(1)
})
