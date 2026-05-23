/**
 * Deterministic overall-score computation.
 *
 * Per design D7 and the aso-audit spec: the overall score is computed in
 * TypeScript from the LLM's per-dimension scores, NOT asked of the LLM. This
 * eliminates a class of drift bugs and lets the math be unit-testable.
 *
 * Renormalization rule: sum (score/10 * weight) across observable dimensions,
 * divide by sum of observable weights, multiply by 100. Non-observable
 * dimensions are excluded from both numerator and denominator so their absence
 * does not artificially depress the score.
 *
 * Edge cases:
 *  - No observable dimensions: returns 0.
 *  - Any observable dimension has score null: treat as 0 (the LLM violated
 *    its contract; we still produce a number rather than throwing).
 */
import type { Dimension } from '@aso/shared'

export function computeOverallScore(dimensions: readonly Dimension[]): number {
  let weightedSum = 0
  let weightTotal = 0

  for (const d of dimensions) {
    if (d.visibility !== 'observable') continue
    const score = d.score ?? 0
    weightedSum += (score / 10) * d.weight
    weightTotal += d.weight
  }

  if (weightTotal === 0) return 0
  const rescaled = (weightedSum / weightTotal) * 100
  // Clamp + round to one decimal place for stable display
  return Math.round(Math.max(0, Math.min(100, rescaled)) * 10) / 10
}
