/**
 * Inline sanity tests for `normalizeDimensions`.
 *
 * Run with:  npm run test:normalize-dimensions --workspace apps/mastra
 *
 * The tests cover the failure modes we have seen the audit model produce in
 * the wild (all from a real Spotify run, see commit history):
 *  - Every dimension marked `not-visible-from-public-listing`.
 *  - Every weight set uniformly to 10.
 *  - `Screenshots` and `Description` emitted twice.
 *  - `App preview video` and `Conversion signals` omitted.
 *
 * After normalization the score must reflect the model's per-dimension
 * judgment, not collapse to 0.
 */
import { strict as assert } from 'node:assert'
import type { Dimension } from '@aso/shared'
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from '@aso/shared'
import { computeOverallScore } from './compute-overall-score'
import { normalizeDimensions } from './normalize-dimensions'

function mkDim(
  name: Dimension['name'],
  partial: Partial<Omit<Dimension, 'name'>> = {},
): Dimension {
  return {
    name,
    weight: 10,
    score: 5,
    evidence: 'test evidence',
    reasoning: 'test reasoning',
    visibility: 'observable',
    ...partial,
  }
}

function testAllNonObservableIsCorrected(): void {
  // Simulate the real Spotify regression: every dimension visibility wrong,
  // every weight uniformly 10, scores are otherwise sensible.
  const input: Dimension[] = [
    mkDim('Title', { score: 8, visibility: 'not-visible-from-public-listing' }),
    mkDim('Subtitle', { score: 9, visibility: 'not-visible-from-public-listing' }),
    mkDim('Description', { score: 8, visibility: 'not-visible-from-public-listing' }),
    mkDim('Screenshots', { score: 0, visibility: 'not-visible-from-public-listing' }),
    mkDim('Ratings & reviews', { score: 9, visibility: 'not-visible-from-public-listing' }),
    mkDim('Competitive position', { score: 7, visibility: 'not-visible-from-public-listing' }),
    mkDim('Keyword field', { score: null, visibility: 'not-visible-from-public-listing' }),
    mkDim('Icon', { score: 8, visibility: 'not-visible-from-public-listing' }),
    // duplicates - second occurrence must be dropped
    mkDim('Screenshots', { score: 0, visibility: 'not-visible-from-public-listing' }),
    mkDim('Description', { score: 8, visibility: 'not-visible-from-public-listing' }),
  ]

  const { dimensions, missing, weightCorrections, visibilityCorrections } =
    normalizeDimensions(input)

  // All ten dimensions present in canonical order.
  assert.deepEqual(
    dimensions.map(d => d.name),
    [...DIMENSION_NAMES],
    'normalized output must contain all ten dimensions in canonical order',
  )

  // Canonical weights everywhere.
  for (const d of dimensions) {
    assert.equal(d.weight, DIMENSION_WEIGHTS[d.name], `weight for ${d.name}`)
  }

  // Only "Keyword field" is non-observable.
  for (const d of dimensions) {
    if (d.name === 'Keyword field') {
      assert.equal(d.visibility, 'not-visible-from-public-listing')
      assert.equal(d.score, null, 'Keyword field score must be null after normalization')
    } else {
      assert.equal(d.visibility, 'observable', `${d.name} must be observable`)
    }
  }

  // Missing dimensions should be flagged. App preview video and Conversion
  // signals were omitted by the LLM in this scenario.
  assert.deepEqual(missing.sort(), ['App preview video', 'Conversion signals'].sort())

  // Of the 8 emitted dimensions, 7 had the wrong weight (10 instead of
  // canonical). "Description" canonically has weight=10 so it was not a
  // correction. App preview video and Conversion signals were missing
  // and so don't get flagged here.
  assert.equal(weightCorrections.length, 7, `weightCorrections: ${weightCorrections.join(', ')}`)

  // Of the 8 emitted dimensions, 7 were observable but marked otherwise.
  // "Keyword field" was correctly non-observable so it wasn't a correction.
  assert.equal(
    visibilityCorrections.length,
    7,
    `visibilityCorrections: ${visibilityCorrections.join(', ')}`,
  )

  // And the score should be meaningful, not 0. With the model's scores
  // restored against canonical weights, we expect somewhere in 60-75.
  // Observable weight total (sans Keyword field) = 100 - 15 = 85.
  // Sum (score/10 * weight) for the LLM-supplied scores:
  //   Title         0.8 * 20 = 16
  //   Subtitle      0.9 * 15 = 13.5
  //   Description   0.8 * 10 = 8
  //   Screenshots   0.0 * 15 = 0
  //   App preview   0.0 * 5  = 0  (placeholder)
  //   Ratings       0.9 * 15 = 13.5
  //   Icon          0.8 * 5  = 4
  //   Conversion    0.0 * 5  = 0  (placeholder)
  //   Competitive   0.7 * 5  = 3.5
  //   total weighted = 58.5 ; renormalized = 58.5 / 85 * 100 = 68.8
  const score = computeOverallScore(dimensions)
  assert.ok(
    score > 60 && score < 75,
    `expected normalized Spotify-shaped score in (60, 75), got ${score}`,
  )
}

function testIdentityWhenInputIsAlreadyCorrect(): void {
  // A well-formed LLM output should pass through unchanged in shape.
  const input: Dimension[] = DIMENSION_NAMES.map(name =>
    mkDim(name, {
      weight: DIMENSION_WEIGHTS[name],
      score: name === 'Keyword field' ? null : 7,
      visibility:
        name === 'Keyword field' ? 'not-visible-from-public-listing' : 'observable',
    }),
  )
  const r = normalizeDimensions(input)
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.weightCorrections, [])
  assert.deepEqual(r.visibilityCorrections, [])
  assert.equal(computeOverallScore(r.dimensions), 70)
}

function testKeywordFieldScoreIsForcedNull(): void {
  // Even if the model hallucinates a Keyword field score, we drop it.
  const input: Dimension[] = [
    mkDim('Keyword field', { score: 7, visibility: 'observable' }),
  ]
  const { dimensions } = normalizeDimensions(input)
  const kf = dimensions.find(d => d.name === 'Keyword field')
  assert.ok(kf)
  assert.equal(kf.score, null)
  assert.equal(kf.visibility, 'not-visible-from-public-listing')
}

function run(): void {
  testAllNonObservableIsCorrected()
  testIdentityWhenInputIsAlreadyCorrect()
  testKeywordFieldScoreIsForcedNull()
  console.log('normalize-dimensions: all tests passed.')
}

run()
