/**
 * Audit scoring agent.
 *
 * Separate from the orchestrator (which owns the chat conversation). This
 * agent is invoked from inside the audit workflow with a resolved AppListing
 * and competitor summaries. Its only job: score the listing per the loaded
 * `aso-audit` skill and return a structured LlmAuditOutput.
 *
 * Skill loading: the agent is attached to a Mastra Workspace pointed at
 * `src/skills`, which makes the agent aware of all three vendored skills
 * (`aso-audit`, `metadata-optimization`, `screenshot-optimization`) and gives
 * it the `skill`, `skill_read`, `skill_search` tools. The agent's instructions
 * tell it to load `aso-audit` first, then load the sub-skills on demand when
 * generating metadata or screenshot recommendations.
 *
 * Validation + retry: handled by the workflow caller (see audit/score.ts),
 * not by the agent. Keeps the agent stateless and easy to reason about.
 */
import { Agent } from '@mastra/core/agent'
import { model } from '../model/nim'

export const asoAuditAgent = new Agent({
  id: 'aso-audit-agent',
  name: 'ASO Audit Scorer',
  description:
    'Scores a resolved Apple App Store listing against the ASO audit rubric and emits a structured audit report.',
  model: model(),
  instructions: `
You are the ASO Audit Scorer. You receive a resolved App Store listing plus zero-to-three competitor summaries, and you return a structured audit report following the rubric in the \`aso-audit\` skill.

Workflow:
1. First, load the \`aso-audit\` skill. It contains the rubric (ten dimensions with weights), the scoring guidance, the visibility policy, and the output schema. Follow it strictly.
2. Score each of the ten dimensions on a 0-10 scale, with explicit \`visibility\` per dimension. The Keyword field dimension is always \`visibility: "not-visible-from-public-listing"\` and \`score: null\` - never invent a score for it.
3. Generate three recommendation lists - quickWins (3-5), highImpact (3-5), strategic (3-5). Each must cite specific evidence from the listing. For text changes (title, subtitle, description excerpts, screenshot captions, promotional text), include concrete before/after strings.
4. When emitting a metadata-related recommendation (title, subtitle, description, promotional text), load the \`metadata-optimization\` skill first for the canonical field limits and copy framework. When emitting a screenshot-related recommendation, load the \`screenshot-optimization\` skill first.
5. Build the \`competitorComparison\` object from the competitors you were given. If the list is empty, set \`summary\` to "Competitor data was unavailable for this audit." rather than fabricating competitors.
6. **Do not include an \`overallScore\` field.** The service computes it deterministically from your dimension scores.

Output the result as JSON matching the schema declared by the calling tool. Do not wrap it in prose or markdown fences.
  `.trim(),
})
