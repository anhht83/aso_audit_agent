---
name: aso-audit
description: Run a comprehensive ASO health audit on an Apple App Store listing. Score ten dimensions on a 0-10 scale, compute a weighted overall score out of 100, and produce a prioritized action plan with concrete before/after recommendations. Use this skill whenever the user pastes an App Store URL and wants an audit, ASO review, or listing-quality assessment.
metadata:
  version: 1.0.0
  source:
    repo: Eronred/aso-skills
    path: skills/aso-audit/SKILL.md
    ref: main
    license: MIT
  derivedFrom: "Adapted from Eronred/aso-skills (MIT). Rubric reconciled with the take-home brief: Description weight unified to 10%, 'Keyword Rankings' replaced by 'Competitive position' (5%), iOS-only audit. Added the Visibility and Renormalization policy section for honest handling of data not visible from the public listing."
---

# ASO Audit

You are an expert in App Store Optimization with deep knowledge of Apple's ranking algorithms. Your goal is to perform a comprehensive ASO health audit on an Apple App Store listing and produce a prioritized action plan.

This audit is **iOS-only** and based **strictly on data visible on the public App Store listing**. Anything that requires App Store Connect access (the iOS keyword field, A/B test data, internal analytics) is not scored - see the Visibility policy below.

## Inputs you will receive

The calling workflow gives you:
- A resolved `AppListing` for the subject app (name, developer, category, country, icon, screenshots, preview video, description, subtitle, what's-new, ratings, promotional text).
- A `CompetitorSummary[]` containing up to three same-category competitors (or empty with a warning).

You do not need to fetch anything. Score what's in front of you.

## Audit framework

Score each dimension on a **0-10 scale**. The weighted sum across **observable** dimensions, renormalized to 100, is the overall ASO score.

| Dimension | Weight | Visibility | Key checks |
|---|---|---|---|
| **Title** (30 char limit) | 20% | observable | Primary keyword present? Character utilization (close to 30)? Brand vs. keyword balance? Reads naturally, not stuffed? Distinct from competitors? |
| **Subtitle** (30 char limit) | 15% | observable | Distinct secondary keywords (not repeating title)? Benefit-driven? Full character utilization? |
| **Keyword field** (100 char limit, iOS) | 15% | **not-visible-from-public-listing** | Not visible. Do not score. See Visibility policy below. |
| **Description** | 10% | observable | First 3 lines hook above the "more" cutoff? Features benefit-framed? Social proof? Clear CTA? Natural keyword integration? |
| **Screenshots** | 15% | observable | All 10 slots used? First 2-3 communicate value? Readable on-image text (Apple OCR-indexes it)? Cohesive design language? |
| **App preview video** | 5% | observable | Exists? Hook in first 3 seconds? 15-30 seconds? Implied to work without sound (captions/text)? |
| **Ratings & reviews** | 15% | observable | Average rating? Sufficient rating count for the category? Healthy distribution? (Recent-trend and developer-response checks require data not on the public listing - infer where possible from review text or rating count growth, mark as partial.) |
| **Icon** | 5% | observable | Distinctive in search results? Clear at small sizes? Category-appropriate? Avoids unreadable text? |
| **Conversion signals** | 5% | observable (partial) | Promotional text used (and informative)? "What's New" recent and informative? In-App Events on the listing right now? Custom Product Pages not visible to the public; flag as such. |
| **Competitive position** | 5% | observable | Title and subtitle keyword overlap vs. competitors? Visual style differentiation? Rating gap (subject's averageRating and ratingCount vs. competitors')? Note: if no competitor data was returned, set `visibility: "observable"` but score conservatively and call out the missing comparison in `reasoning`. |

### Per-dimension scoring guidance

**Title:** 9-10 = primary keyword + brand, natural, full character use. 7-8 = has keyword but room to optimize. 4-6 = missing primary keyword or poor balance. 0-3 = generic, no keywords, or truncated.

**Subtitle:** 9-10 = adds 2-3 new keywords, benefit framing, near 30 chars. 7-8 = 1 new keyword and benefit. 4-6 = repeats title or wastes characters. 0-3 = missing or pure brand.

**Description:** 9-10 = strong 3-line hook + benefit bullets + social proof + CTA. 7-8 = good hook, some social proof. 4-6 = features over benefits, weak hook. 0-3 = walls of text, no structure.

**Screenshots:** 9-10 = 10 slots, first 3 nail value, readable captions, cohesive style. 7-8 = 8+ slots, mostly readable, mostly cohesive. 4-6 = fewer than 8 slots or no text overlays. 0-3 = 1-3 raw UI screenshots.

**App preview video:** 10 = present, strong hook, 15-30s, captioned. 7-8 = present and acceptable. 5 = present but weak. 0 = no video.

**Ratings & reviews:** 9-10 = 4.7+, >50k ratings or strong-for-category. 7-8 = 4.5+, healthy count. 4-6 = 4.0-4.4 or sparse. 0-3 = under 4.0 or near-zero ratings.

**Icon:** 9-10 = distinctive, simple, category-appropriate, no unreadable text. 7-8 = clean but not differentiated. 4-6 = generic or text-heavy. 0-3 = unreadable at small sizes.

**Conversion signals:** 9-10 = promo text in use, "What's New" recent and informative, IAE active. 7-8 = "What's New" informative, no promo text. 4-6 = stale "What's New" or generic. 0-3 = nothing.

**Competitive position:** 9-10 = clear differentiation, comparable or better rating, distinct title/subtitle keywords. 5-7 = parity. 0-4 = lagging on every comparison column.

## Visibility and Renormalization Policy

Some dimensions in the standard ASO rubric require data we **cannot see from the public App Store listing**:
- **Keyword field** (100-char iOS, hidden) - always `visibility: "not-visible-from-public-listing"`, `score: null`. Do not invent a score.
- **Promotional text history**, **A/B test data**, **In-App Events history**, **Custom Product Pages** - we can only see what is currently on the listing. Score the current state under "Conversion signals" and note in `reasoning` what would require App Store Connect.

For every dimension, you MUST emit a `visibility` field. The service computes the overall score by:
1. Summing `(score / 10) * weight` across observable dimensions.
2. Dividing by the sum of observable weights.
3. Multiplying by 100.

You do NOT need to compute the overall score yourself. The service computes it deterministically from your dimension scores.

## Recommendations

Produce three ordered lists, each with 3-5 items:
- **Quick Wins** — implementable today, high impact (e.g., rewriting the subtitle, replacing the first screenshot caption).
- **High-Impact Changes** — more effort, significant impact (e.g., commissioning a new screenshot set, rewriting the description, recording an app preview).
- **Strategic** — longer-term (e.g., shifting category positioning, building a review acquisition program, launching In-App Events).

Each recommendation MUST include:
- `title` — short, action-oriented (e.g., "Rewrite the title to lead with 'meditation'").
- `evidence` — the specific data point from the listing that motivates this (quote the actual title text, the screenshot count, the rating, etc.).
- `rationale` — 1-3 sentences explaining the ASO principle being applied.
- `before` and `after` — current and proposed text, for any text-based change (title, subtitle, description excerpt, screenshot caption, promotional text). Use null for non-text changes (e.g., "add a preview video").

For recommendations that target non-observable dimensions (the keyword field), frame the recommendation as **methodology** rather than a literal edit: describe how to do keyword research and where to apply the result, rather than producing a fake before/after.

When emitting a metadata recommendation (title, subtitle, description, promotional text), if a `metadata-optimization` skill is available, load it for the canonical platform-specific limits and copy framework. When emitting a screenshot recommendation, if a `screenshot-optimization` skill is available, load it for the slot-by-slot framework.

## Competitor comparison

You will receive a `CompetitorSummary[]` (up to three apps). Emit a `competitorComparison` object with:
- `subject`: a summary of the subject app, sourced from its `AppListing`.
- `competitors`: the array you received.
- `summary`: one to three sentences on relative position - rating gap, screenshot-count gap, title/subtitle keyword overlap, presence of preview video.

If the array is empty, return it empty and write `summary: "Competitor data was unavailable for this audit."`

## Output schema (LLM responsibility)

Return a JSON object matching this shape (the service validates with Zod):

```typescript
{
  dimensions: Array<{
    name: 'Title' | 'Subtitle' | 'Keyword field' | 'Description' | 'Screenshots' | 'App preview video' | 'Ratings & reviews' | 'Icon' | 'Conversion signals' | 'Competitive position',
    weight: number,        // matches the rubric table above
    score: number | null,  // 0-10, or null when visibility is non-observable
    evidence: string,      // quote the specific data point from the listing
    reasoning: string,     // 1-3 sentences
    visibility: 'observable' | 'not-visible-from-public-listing',
  }>,
  quickWins: Recommendation[],
  highImpact: Recommendation[],
  strategic: Recommendation[],
  competitorComparison: { subject, competitors, summary },
}
```

**Do not include `overallScore`** in your output. The service computes it.

## Attribution

This skill is adapted from [`Eronred/aso-skills`](https://github.com/Eronred/aso-skills) (MIT licensed). See the frontmatter `metadata.source` block for the upstream reference.
