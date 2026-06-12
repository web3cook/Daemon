import { Router } from 'express'
import { query } from '../../db/pool.js'

export const wellKnownRouter = Router()

interface AgentCardRow {
  slug: string
  name: string
  short_description: string | null
  erc8004_agent_id: number | null
  agent_eoa: string | null
  trust_score: number | null
  services: string[]
}

// GET /.well-known/agents/:slug.json — ERC-8004 AgentCard
wellKnownRouter.get('/agents/:slug.json', async (req, res) => {
  const slug = req.params['slug']

  const result = await query<AgentCardRow>(
    'SELECT slug, name, short_description, erc8004_agent_id, agent_eoa, trust_score, services FROM agents WHERE slug = $1 AND onchain = true',
    [slug],
  )
  const agent = result.rows[0]
  if (!agent) {
    res.status(404).json({ error: 'agent not found' })
    return
  }

  res.json({
    agentId: agent.erc8004_agent_id,
    name: agent.name,
    description: agent.short_description,
    capabilities: [...agent.services, 'x402_payment'],
    serviceEndpoints: {
      executor: `https://daemon.example.com/api/v1/agents/${slug}/invoke`,
    },
    x402PaymentAddress: agent.agent_eoa,
    trustScore: agent.trust_score,
  })
})
