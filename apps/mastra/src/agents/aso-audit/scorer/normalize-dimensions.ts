/**
 * Server-side normalization of the LLM's per-dimension output.
 *
 * Why this exists
 * ---------------
 * The audit model is responsible for *judgment* (score, evidence, reasoning,
 * recommendations). It is NOT a reliable source for the structural shape of
 * the rubric: weights, visibility, dimension membership, deduplication.
 * Smaller open models (e.g. llama-3.3-70b on NIM) regularly:
 *   - Repeat the wrong weight uniformly (every dimension weight = 10).
 *   - Mis-mark visibility (e.g. `not-visible-from-public-listing` on every
 *     dimension, which sends `computeOverallScore` to 0 because no
 *     dimension contributes to the weighted sum).
 *   - Duplicate some dimensions and omit others.
 *
 * Those mistakes can collapse a perfectly good Spotify audit to 0/100 even
 * though the per-dimension scores look right.
 *
 * Contract enforced here
 * ----------------------
 *   - Every dimension in DIMENSION_NAMES appears exactly once.
 *   - `weight` is always the canonical DIMENSION_WEIGHTS[name].
 *   - `Keyword field` is always `visibility: 'not-visible-from-public-listing'`
 *     and `score: null`. Every other dimension is `visibility: 'observable'`.
 *   - The model's score/evidence/reasoning are preserved when present, with
 *     conservative placeholders when the model dropped a dimension.
 *
 * The model can still produce wrong scores. That's a judgment problem the
 * skill prompt addresses. This module only guarantees the structural
 * contract the scoring math depends on.
 */
import {
  DIMENSION_NAMES,
  DIMENSION_WEIGHTS,
  type Dimension,
  type DimensionName,
} from '@aso/shared'

const NON_OBSERVABLE: ReadonlySet<DimensionName> = new Set<DimensionName>(['Keyword field'])

const PLACEHOLDER_EVIDENCE =
  'The audit model did not emit this dimension. The service inserted a structural placeholder so the report stays complete.'
const PLACEHOLDER_REASONING =
  'No reasoning was emitted by the audit model. Re-run the audit if the placeholder is unexpected.'

export interface NormalizeResult {
  dimensions: Dimension[]
  /** Names of dimensions the model omitted (or duplicated past the first occurrence). */
  missing: DimensionName[]
  /** Names of dimensions whose `weight` the model emitted incorrectly. */
  weightCorrections: DimensionName[]
  /** Names of dimensions whose `visibility` the model emitted incorrectly. */
  visibilityCorrections: DimensionName[]
}

export function normalizeDimensions(input: readonly Dimension[]): NormalizeResult {
  // Index by canonical name, keeping the first occurrence. We do NOT merge
  // duplicates - the second occurrence is dropped to avoid double-counting.
  const byName = new Map<DimensionName, Dimension>()
  const allowed = new Set<DimensionName>(DIMENSION_NAMES)
  for (const d of input) {
    if (!allowed.has(d.name)) continue
    if (!byName.has(d.name)) byName.set(d.name, d)
  }

  const missing: DimensionName[] = []
  const weightCorrections: DimensionName[] = []
  const visibilityCorrections: DimensionName[] = []

  const dimensions: Dimension[] = DIMENSION_NAMES.map(name => {
    const expectedWeight = DIMENSION_WEIGHTS[name]
    const expectedVisibility: Dimension['visibility'] = NON_OBSERVABLE.has(name)
      ? 'not-visible-from-public-listing'
      : 'observable'

    const fromLlm = byName.get(name)
    if (!fromLlm) {
      missing.push(name)
      return {
        name,
        weight: expectedWeight,
        score: NON_OBSERVABLE.has(name) ? null : 0,
        evidence: PLACEHOLDER_EVIDENCE,
        reasoning: PLACEHOLDER_REASONING,
        visibility: expectedVisibility,
      }
    }

    if (fromLlm.weight !== expectedWeight) weightCorrections.push(name)
    if (fromLlm.visibility !== expectedVisibility) visibilityCorrections.push(name)

    return {
      name,
      weight: expectedWeight,
      score: NON_OBSERVABLE.has(name) ? null : fromLlm.score,
      evidence: fromLlm.evidence,
      reasoning: fromLlm.reasoning,
      visibility: expectedVisibility,
    }
  })

  return { dimensions, missing, weightCorrections, visibilityCorrections }
}
