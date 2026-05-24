/**
 * Audit scoring agent.
 *
 * Separate from the orchestrator (which owns the chat conversation). This
 * agent is invoked from inside the audit workflow with a resolved AppListing
 * and competitor summaries. Its only job: score the listing per the loaded
 * `aso-audit` skill and return a structured LlmAuditOutput.
 *
 * Skill loading: the agent is attached to a Mastra Workspace pointed at
 * `src/skills`, which makes the agent aware of the `aso-audit` skill and
 * gives it the `skill`, `skill_read`, `skill_search` tools. The agent's
 * instructions tell it to load `aso-audit` before generating the report.
 *
 * Validation + retry: handled by the workflow caller (see scorer/),
 * not by the agent. Keeps the agent stateless and easy to reason about.
 */
import { Agent } from '@mastra/core/agent'
import { model } from '../../model/nim'

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
2. Emit exactly TEN dimensions, in this exact order and with these exact weights and visibility values. Do NOT change weights, do NOT mark a dimension non-observable other than "Keyword field", do NOT duplicate or omit a dimension:
   - "Title"                weight=20  visibility="observable"
   - "Subtitle"             weight=15  visibility="observable"
   - "Keyword field"        weight=15  visibility="not-visible-from-public-listing"  score=null  (ALWAYS)
   - "Description"          weight=10  visibility="observable"
   - "Screenshots"          weight=15  visibility="observable"
   - "App preview video"    weight=5   visibility="observable"
   - "Ratings & reviews"    weight=15  visibility="observable"
   - "Icon"                 weight=5   visibility="observable"
   - "Conversion signals"   weight=5   visibility="observable"
   - "Competitive position" weight=5   visibility="observable"
3. Score each observable dimension on a 0-10 integer scale based on the per-dimension guidance in the skill. "Keyword field" is the ONLY dimension that gets score=null; every other dimension gets a number 0-10.
4. Generate three recommendation lists - quickWins (3-5), highImpact (3-5), strategic (3-5). Each must cite specific evidence from the listing. For text changes (title, subtitle, description excerpts, screenshot captions, promotional text), include concrete before/after strings.
5. Build the \`competitorComparison\` object from the competitors you were given. If the list is empty, set \`summary\` to "Competitor data was unavailable for this audit." rather than fabricating competitors.
6. **Do not include an \`overallScore\` field.** The service computes it deterministically from your dimension scores.

Output the result as JSON matching the schema declared by the calling tool. Do not wrap it in prose or markdown fences.
  `.trim(),
})
