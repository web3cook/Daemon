import Anthropic from '@anthropic-ai/sdk'
import { logger } from '../../logger.js'
import { ClaudeResponseError } from '../../errors.js'

const SYSTEM_PROMPT = `You are Clerk, a bookkeeping agent. You categorize business transactions
into a standard chart-of-accounts category.

Categories: revenue, cost_of_goods_sold, payroll, rent, utilities, software_subscriptions,
marketing, travel, professional_services, taxes, equipment, other.

Respond ONLY with a JSON object. No markdown, no explanation outside the JSON:
{"category": string, "confidence": number (0-1), "reasoning": "one sentence"}`

export interface CategorizeInput {
  description: string
  amount?: string
  currency?: string
}

export interface CategorizeResult {
  category:   string
  confidence: number
  reasoning:  string
}

function isCategorizeResult(v: unknown): v is CategorizeResult {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    typeof d['category']   === 'string' &&
    typeof d['confidence'] === 'number' &&
    typeof d['reasoning']  === 'string'
  )
}

export class ClerkAgent {
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async categorize(input: CategorizeInput): Promise<CategorizeResult> {
    const userPrompt = [
      `Description: ${input.description}`,
      input.amount ? `Amount: ${input.amount} ${input.currency ?? 'USD'}` : '',
      '',
      'Categorize this transaction and respond with the JSON object.',
    ].filter(Boolean).join('\n')

    const msg = await this.client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    })

    const raw = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const start = jsonStr.indexOf('{')
    const end   = jsonStr.lastIndexOf('}')
    if (start === -1 || end === -1) throw new ClaudeResponseError(raw)

    const parsed: unknown = JSON.parse(jsonStr.slice(start, end + 1))
    if (!isCategorizeResult(parsed)) throw new ClaudeResponseError(raw)

    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence))

    logger.debug({ input, result: parsed }, 'clerk categorization')
    return parsed
  }
}
