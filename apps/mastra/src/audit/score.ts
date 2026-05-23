/**
 * Audit scoring driver.
 *
 * Wraps the asoAuditAgent in:
 *   - structured-output generation with the LlmAuditOutput schema,
 *   - one retry with the validation error fed back in on schema failure,
 *   - assembly of the final AuditReport (attaches the resolved listing and
 *     the deterministically computed overall score).
 *
 * Throws on hard failure after one retry. The workflow turns that into a
 * typed error message for the user.
 */
import {
  type AppListing,
  type AuditReport,
  type CompetitorSummary,
  llmAuditOutputSchema,
} from '@aso/shared'
import { asoAuditAgent } from '../agents/aso-audit-agent.ts'
import { computeOverallScore } from './compute-overall-score.ts'

export class AuditScoringError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AuditScoringError'
  }
}

interface ScoreArgs {
  listing: AppListing
  competitors: readonly CompetitorSummary[]
  competitorWarning?: string
}

function buildPrompt({ listing, competitors, competitorWarning }: ScoreArgs): string {
  const competitorBlock =
    competitors.length === 0
      ? `[]\n\nNote: ${competitorWarning ?? 'No competitor data was returned for this audit.'}`
      : JSON.stringify(competitors, null, 2)

  return [
    'Score the following Apple App Store listing using the `aso-audit` skill. Return a JSON object that matches the output schema declared on the tool. Do not include an `overallScore` field.',
    '',
    '## App listing',
    '```json',
    JSON.stringify(listing, null, 2),
    '```',
    '',
    '## Competitors',
    '```json',
    competitorBlock,
    '```',
  ].join('\n')
}

/**
 * Run the audit and return the final AuditReport.
 *
 * Retries exactly once on Zod validation failure: the second attempt sees the
 * validation error message as additional context. A second failure throws
 * AuditScoringError.
 */
export async function runAudit(args: ScoreArgs): Promise<AuditReport> {
  const basePrompt = buildPrompt(args)

  const attempt = async (extraContext?: string) => {
    const promptText = extraContext ? `${basePrompt}\n\n${extraContext}` : basePrompt
    // Verified against @mastra/core@1.36.0: the option key is `structuredOutput`
    // (NOT `output`), it's an object with `schema`, and the parsed value is at
    // response.object. The SDK handles JSON mode + parsing for us; we still
    // validate below as defense in depth.
    const response = await asoAuditAgent.generate(promptText, {
      structuredOutput: { schema: llmAuditOutputSchema },
    })
    return response.object
  }

  let parsed
  try {
    const raw = await attempt()
    const result = llmAuditOutputSchema.safeParse(raw)
    if (result.success) {
      parsed = result.data
    } else {
      const issues = result.error.issues
        .map(i => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')
      const retry = await attempt(
        `Your previous output failed schema validation. Fix these issues and return a valid JSON object that matches the output schema:\n${issues}`,
      )
      const retryResult = llmAuditOutputSchema.safeParse(retry)
      if (!retryResult.success) {
        throw new AuditScoringError(
          'The audit model returned output that did not match the expected schema on both attempts. Please try again.',
          retryResult.error,
        )
      }
      parsed = retryResult.data
    }
  } catch (e) {
    if (e instanceof AuditScoringError) throw e
    throw new AuditScoringError(
      'The audit model could not be reached or returned an unrecoverable error. Please try again.',
      e,
    )
  }

  const overallScore = computeOverallScore(parsed.dimensions)

  return {
    app: args.listing,
    overallScore,
    dimensions: parsed.dimensions,
    quickWins: parsed.quickWins,
    highImpact: parsed.highImpact,
    strategic: parsed.strategic,
    competitorComparison: parsed.competitorComparison,
  }
}
