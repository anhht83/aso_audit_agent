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

// ---------------------------------------------------------------------------
// Inline sanity tests (run with: npx tsx compute-overall-score.ts)
// ---------------------------------------------------------------------------

function approxEqual(a: number, b: number, epsilon = 0.05): boolean {
  return Math.abs(a - b) < epsilon
}

function mkDim(
  name: Dimension['name'],
  weight: number,
  score: number | null,
  visibility: Dimension['visibility'] = 'observable',
): Dimension {
  return { name, weight, score, evidence: 'test', reasoning: 'test', visibility }
}

function runTests(): void {
  // Case 1: all observable, perfect 10s -> 100
  const allTens: Dimension[] = [
    mkDim('Title', 20, 10),
    mkDim('Subtitle', 15, 10),
    mkDim('Description', 10, 10),
    mkDim('Screenshots', 15, 10),
    mkDim('App preview video', 5, 10),
    mkDim('Ratings & reviews', 15, 10),
    mkDim('Icon', 5, 10),
    mkDim('Conversion signals', 5, 10),
    mkDim('Competitive position', 5, 10),
  ]
  // 95 total weight, all observable -> 100
  if (!approxEqual(computeOverallScore(allTens), 100)) {
    throw new Error(`expected 100, got ${computeOverallScore(allTens)}`)
  }

  // Case 2: all observable, all 5s -> 50
  const allFives = allTens.map(d => ({ ...d, score: 5 }))
  if (!approxEqual(computeOverallScore(allFives), 50)) {
    throw new Error(`expected 50, got ${computeOverallScore(allFives)}`)
  }

  // Case 3: keyword field non-observable. Without it, weight total = 95.
  // If every observable dim scores 8, weighted sum = 0.8 * 95 = 76,
  // renormalized = 76 / 95 * 100 = 80.
  const withKeywordHidden: Dimension[] = [
    ...allTens.map(d => ({ ...d, score: 8 })),
    mkDim('Keyword field', 15, null, 'not-visible-from-public-listing'),
  ]
  if (!approxEqual(computeOverallScore(withKeywordHidden), 80)) {
    throw new Error(`expected 80, got ${computeOverallScore(withKeywordHidden)}`)
  }

  // Case 4: all non-observable -> 0 (defensive)
  const allHidden = allTens.map(d => ({
    ...d,
    visibility: 'not-visible-from-public-listing' as const,
    score: null,
  }))
  if (computeOverallScore(allHidden) !== 0) {
    throw new Error(`expected 0, got ${computeOverallScore(allHidden)}`)
  }

  console.log('compute-overall-score: all tests passed.')
}

// Only run when this file is executed directly via tsx.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) runTests()
