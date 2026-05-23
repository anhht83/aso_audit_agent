---
name: metadata-optimization
description: Reference for writing or revising Apple App Store metadata — title, subtitle, keyword field, description, promotional text. Load this skill when the audit emits a recommendation that requires before/after text for any of those fields.
metadata:
  version: 1.0.0
  source:
    repo: Eronred/aso-skills
    path: skills/metadata-optimization/SKILL.md
    ref: main
    license: MIT
  derivedFrom: "Adapted from Eronred/aso-skills (MIT). Appeeky-dependent steps (live keyword volume, rank lookups, 'Check for app-marketing-context.md' router flow) removed. Android-specific sections removed (audit is iOS-only). Kept: platform limits, formulas, copy frameworks, output structure."
---

# Metadata Optimization

You are an expert ASO copywriter who specializes in crafting Apple App Store metadata that maximizes both search visibility and conversion rate.

## When to use this skill

Load this skill when the audit needs to generate a before/after text change for any of:
- Title (30 char limit)
- Subtitle (30 char limit)
- Keyword field (100 char limit) — note: this field is **not visible** on the public listing, so for audits run on the public listing you produce methodology guidance rather than a literal before/after edit.
- Description (4000 char limit)
- Promotional text (170 char limit)

## Apple App Store field limits

| Field | Limit | Indexed for search? | Notes |
|---|---|---|---|
| Title | 30 chars | Yes | Highest keyword weight |
| Subtitle | 30 chars | Yes | Second highest weight |
| Keyword field | 100 chars | Yes | Hidden, comma-separated, set in App Store Connect |
| Description | 4000 chars | No | For conversion only |
| Promotional text | 170 chars | No | Can change without app review |
| What's New | 4000 chars | No | Shown on update |

## Title

**Goal:** Include the #1 target keyword naturally alongside the brand name.

**Formulas that work:**
- `[Brand] - [Primary Keyword]` (e.g., "Calm - Sleep & Meditation")
- `[Brand]: [Benefit Phrase]` (e.g., "Duolingo: Language Lessons")
- `[Primary Keyword] [Brand]` (e.g., "Headspace: Mindful Meditation")

**Rules:**
- Lead with the brand if it's well-known; lead with the keyword if it isn't.
- Don't stuff multiple keywords unnaturally.
- Must read naturally — users see this in search results.
- Use close to the full 30 characters.
- Avoid special characters that waste space (™, ®).

## Subtitle

**Goal:** Add secondary keywords that complement the title.

**Rules:**
- Never repeat keywords from the title (Apple indexes both fields).
- Focus on benefits, not features.
- Use close to the full 30 characters.
- Can carry a call-to-action feel.

## Keyword field

The keyword field is hidden and set in App Store Connect. For audits run on the public listing, recommend **methodology** rather than producing a literal before/after edit:

**Rules to communicate:**
- Comma-separated, **no spaces** after commas (every wasted character is a lost keyword).
- Never repeat words from title or subtitle.
- Use singular forms only — Apple indexes both forms.
- Don't include your app name or category name.
- Don't include "app" or "free".
- Don't include competitor brand names (policy violation).
- Prioritize by `volume × relevance`.

## Description

**Structure:**
1. **Hook (first 3 lines)** — this is all users see before the "more" tap. Make it count.
2. **Social proof** — awards, press mentions, user count, rating.
3. **Key features** — 4-6 bullets, benefits not features.
4. **How it works** — 3-step explanation.
5. **Testimonial or review quote** — real user voice.
6. **CTA** — clear call to download.

**Rules:**
- The first 170 characters are critical (visible without tapping "more").
- Use line breaks and emoji for scannability.
- Focus on benefits ("Sleep better tonight") not features ("White noise generator").
- Include social proof early.

## Promotional text

**Goal:** Timely messaging that doesn't require app review.

**Use for:**
- Seasonal promotions ("New Year, New You — 50% off Premium")
- Feature launches ("Now with AI-powered recommendations")
- Awards or milestones
- Events

## Common mistakes to flag

- Repeating keywords across title, subtitle, and (hidden) keyword field.
- Using plural forms in the keyword field (wastes characters).
- Spaces after commas in the keyword field.
- Including the brand name in the keyword field.
- Keyword stuffing that hurts readability.
- Not using the full character allowance.
- Descriptions that start with "Welcome to..." (weak hook).

## Output guidance for the audit

When the audit consults this skill, return a single concrete before/after with:
- The current text from the listing (quoted exactly).
- A proposed replacement within the field's character limit.
- A one- to three-sentence rationale grounded in the rules above.

## Attribution

Adapted from [`Eronred/aso-skills`](https://github.com/Eronred/aso-skills) (MIT). See frontmatter for the upstream reference and the list of removed sections.
