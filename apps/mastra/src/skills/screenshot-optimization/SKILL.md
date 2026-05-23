---
name: screenshot-optimization
description: Reference for designing or evaluating Apple App Store screenshots and the App Preview video. Load this skill when the audit emits a recommendation that targets screenshots or the preview video.
metadata:
  version: 1.0.0
  source:
    repo: Eronred/aso-skills
    path: skills/screenshot-optimization/SKILL.md
    ref: main
    license: MIT
  derivedFrom: "Adapted from Eronred/aso-skills (MIT). Appeeky-dependent steps ('Check for app-marketing-context.md' router flow, App ID prompts) removed. Kept: slot strategy, design best practices, video guidance, output structure."
---

# Screenshot Optimization

You are an expert in App Store creative optimization. Your goal is to help generate concrete screenshot and preview-video recommendations that maximize conversion.

## When to use this skill

Load this skill when the audit needs to produce a recommendation that targets:
- Screenshots (the 10 slot strategy, individual slot improvements, text overlay copy).
- The App Preview video (presence, length, hook, captions).

## Screenshot psychology

Users spend **3-6 seconds** on a product page before deciding. The first 3 screenshots (visible without scrolling) drive ~80% of the conversion decision.

**What users look for:**
1. "Does this solve my problem?" (first screenshot)
2. "Is it easy to use?" (UI clarity)
3. "Is it worth downloading?" (social proof, quality signals)

## Slot-by-slot strategy

### Slot 1: The Hook

The most important screenshot. Should answer "What does this app do and why should I care?"

**Effective patterns:**
- **Benefit headline + key UI** — "Sleep Better Tonight" + sleep tracking screen.
- **Before/After** — show the transformation.
- **Social proof + UI** — "5M+ users trust us" + main screen.
- **Problem statement** — "Tired of [problem]?" + solution screen.

**Avoid:**
- Generic "Welcome to [App]" screens.
- Login/signup screens.
- Settings or menu screens.

### Slots 2-3: Core Value

The two most compelling features with benefit-driven captions.

### Slots 4-7: Feature Showcase

Each screenshot = one feature with a benefit headline.

**Formula:** `[Benefit Headline] + [Feature UI] + [Supporting Detail]`

### Slots 8-9: Trust and Differentiation

- Awards, press mentions, ratings.
- Comparison with alternatives.
- Premium or unique features.

### Slot 10: Call to Action

- "Start your free trial"
- "Join [X] million users"
- Recap of key benefits.

## Design best practices

### Text overlays

| Do | Don't |
|----|----|
| Benefit-driven headlines | Feature names ("Push Notifications") |
| 4-6 words per headline | Long paragraphs |
| Large, readable font (min 60px) | Small text that's unreadable |
| High contrast text | Text over busy backgrounds |
| Consistent font and style | Mixed fonts and sizes |

### Visual design

| Do | Don't |
|----|----|
| Clean, uncluttered UI | Busy screens with too much data |
| Consistent color scheme | Clashing colors |
| Modern device frames (or frameless) | Outdated device frames |
| Real app content | Placeholder or empty states |
| Dark mode if your app supports it | Ignoring dark mode users |

## App Preview video

### When to use
- Complex apps that need demonstration.
- Games (almost always beneficial).
- Apps with unique interactions.

### Best practices
- **Hook in first 3 seconds** — show the most impressive feature.
- **15-30 seconds** optimal length.
- **No sound dependency** — add captions/text overlays.
- **Show real usage** — not marketing fluff.
- **End with CTA** — "Download Free" or key benefit.

### When to skip
- Simple utility apps (screenshots are enough).
- Apps where the value is in content, not UI.

## Output guidance for the audit

When the audit consults this skill for a recommendation, produce a concrete change with:
- **Evidence** — the specific observation from the listing (e.g., "only 4 screenshots used, first is a login screen, no text overlays").
- **Proposed change** — exactly what to do (which slot, which copy, which screen to show). For text overlay changes include a before/after of the caption copy.
- **Rationale** — 1-3 sentences grounded in the framework above.

## Attribution

Adapted from [`Eronred/aso-skills`](https://github.com/Eronred/aso-skills) (MIT). See frontmatter for the upstream reference and the list of removed sections.
