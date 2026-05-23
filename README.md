# ASO Audit Agent

Chat-driven App Store Optimization audits, built on [Mastra](https://mastra.ai). Paste an Apple App Store URL, confirm the app, watch the audit run, get a structured report with prioritized recommendations.

## Quickstart

```bash
# 1. Install
npm install

# 2. Configure
cp apps/mastra/.env.example apps/mastra/.env
cp apps/web/.env.example apps/web/.env.local
# Edit apps/mastra/.env and fill in FIRECRAWL_API_KEY and LLM_API_KEY.
# apps/web/.env.local works out of the box for local dev.

# 3. Run
npm run dev
```

That starts both services in one terminal:
- **Mastra service** on `http://localhost:4111`
- **Next.js UI** on `http://localhost:3000`

Open `http://localhost:3000` and paste an App Store URL, e.g. `https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580`.

Node 20.9+ is required.

## How it flows

1. You paste an App Store URL into the chat.
2. The agent scrapes the listing via Firecrawl, then asks you to confirm the app (a card with the icon, name, developer, category, country).
3. On confirmation the audit workflow resumes: fetches up to three same-category competitors via Apple's iTunes Search API (with one Firecrawl enrichment scrape per competitor), then invokes the scoring agent.
4. The scoring agent loads the `aso-audit` skill, scores ten dimensions on a 0-10 scale, and emits a structured `AuditReport`. The overall score (0-100) is computed deterministically by the service, not by the model.
5. The UI renders the report: prominent overall score, per-dimension bars, Quick Wins / High-Impact / Strategic recommendation sections (with before/after for text edits), and a competitor comparison table.

## Architecture: the Mastra primitive map

| Primitive | What it owns |
|---|---|
| **Tools** | `fetchAppMetadata` (Firecrawl + URL validation → `AppListing`), `fetchCompetitors` (iTunes Search + Firecrawl enrichment → `CompetitorSummary[]`) |
| **Skills** | `aso-audit` (primary rubric, ten dimensions and weights, output schema, visibility policy), `metadata-optimization` and `screenshot-optimization` (loaded on demand for before/after generation of those recommendation types). All three vendored from [`Eronred/aso-skills`](https://github.com/Eronred/aso-skills) — see Decisions below. |
| **Workflow** | `asoAuditWorkflow` — two steps with a human-in-the-loop suspend between them. `resolveListing` scrapes and suspends with the listing; `runAudit` resumes with `{ confirmed }`, runs competitor fetch + scoring, returns the final `AuditReport`. Emits `progress` events through the workflow `writer`. |
| **Agent** | `asoAuditAgent` — the scoring agent. Receives the resolved listing + competitor summaries, loads the `aso-audit` skill, emits a structured `LlmAuditOutput` (validated by Zod with one retry on failure). |
| **Server route** | `POST /chat` — accepts `{ kind: 'start', text }` or `{ kind: 'resume', resumeToken, confirmed }`, streams `StreamEvent`s as newline-delimited JSON (`application/x-ndjson`) over a Web Stream. |

The Next.js app is a separate workspace package that proxies `/api/agent/*` → Mastra and renders the chat UI plus the report.

## Decisions left to us

The take-home brief was deliberate about which choices to leave open. Here is what I chose and why.

### Monorepo: Mastra service + Next.js app, single `npm run dev`

Two packages (`apps/mastra`, `apps/web`) plus one shared workspace (`packages/shared`) for the network-contract Zod schemas. Run concurrently from the root with `concurrently`. One install, one dev command, no Turborepo or Nx overhead. Lets the architectural seam (UI ↔ agent service) be obvious in the directory tree while keeping the deliverable a single command.

### Custom Next.js UI rather than Mastra's playground

The brief asks for recommendations that are "actually nice to look at." Mastra's built-in playground renders Markdown, which is fine, but a typed `AuditReport` object lets the UI render real components — bars per dimension, color-coded before/after diffs, a competitor table, an explicit "not visible from public listing" treatment for hidden dimensions. Worth the additional code.

### NVIDIA NIM as the default LLM (swappable in one variable)

NIM is the brief's free-tier suggestion and speaks the OpenAI protocol, so it plugs cleanly into Mastra's model router via `{ id, url, apiKey }`. To swap providers, change `LLM_BASE_URL` and `LLM_API_KEY` in `apps/mastra/.env`. For OpenAI: `LLM_BASE_URL=https://api.openai.com/v1` and a tool-calling model like `gpt-4o-mini`. For local models via LMStudio: `LLM_BASE_URL=http://localhost:1234/v1`. Anthropic doesn't speak OpenAI's protocol — for that, use Mastra's native `anthropic/<model>` string in `src/agents/aso-audit-agent.ts`.

### Firecrawl for scraping, with a typed `Scraper` interface

Firecrawl is the brief's suggested option, handles JS-heavy pages, and supports Zod-typed extraction so the scraper survives small markup changes. All Firecrawl-specific code lives in `apps/mastra/src/scrape/firecrawl.ts`; the rest of the service depends only on the `Scraper` interface.

### Competitors via Apple's iTunes Search API, not chart scraping

The free, JSON-only iTunes Search API gives us the candidate list cheaply (no Firecrawl call), and we use one Firecrawl call per competitor to get the few enrichment fields the audit table needs (subtitle, screenshot count, preview-video presence, rating). Three full listing scrapes per audit would exhaust the Firecrawl free tier in a few demo runs.

### Honest handling of non-observable data

Some dimensions in the standard ASO rubric require data the public listing does not expose:
- **iOS keyword field (100 chars):** never visible. Always reported as `score: null`, `visibility: not-visible-from-public-listing`. The audit produces methodology guidance for it rather than a fake before/after.
- **A/B test data, full promotional-text history, Custom Product Pages:** not visible. We score the current promotional text and "What's New" under "Conversion signals" but call out what would require App Store Connect access in the recommendation rationale.

The overall score is **renormalized** to exclude non-observable dimensions: sum `(score/10 × weight)` across observable dimensions, divide by sum of observable weights, multiply by 100. This way the user gets a score out of 100 that reflects what we could actually measure, rather than being penalized for the keyword field's invisibility.

### Deterministic overall-score computation

The LLM scores each dimension; the service computes `overallScore` from those scores using `compute-overall-score.ts`. The LLM is not asked for `overallScore` and any field it emits is ignored. Eliminates a class of drift bugs and makes the math unit-testable.

### Audit skill source: adapted from `Eronred/aso-skills` (MIT)

The brief notes its rubric was "adapted from the open-source [aso-skills](https://github.com/Eronred/aso-skills) project." Rather than paraphrasing the same rubric a second time and pretending I wrote it from scratch, I vendor three of its `SKILL.md` files into `apps/mastra/src/skills/` with attribution preserved in each file's frontmatter:

- `aso-audit` — primary rubric, **reconciled** to match the brief's exact table (Description flat 10%, "Competitive position" 5% replacing upstream's "Keyword Rankings" 10%, iOS-only). I added a "Visibility and Renormalization" section spelling out our public-listing-only policy.
- `metadata-optimization` — loaded by the audit agent when emitting a recommendation that requires before/after text for the title, subtitle, description, or promotional text. Upstream's Appeeky-dependent steps (live keyword volume lookups, "Check for app-marketing-context.md" router flow) are trimmed. Android-specific sections are dropped.
- `screenshot-optimization` — loaded for screenshot-related recommendations. Similarly trimmed.

I deliberately **do not** vendor the other 25+ skills in the upstream repo. Most of them assume the paid Appeeky MCP is connected for live keyword and rank data; without that, they'd either fabricate data (dishonest) or shrink to stubs (worse than not having them).

I also deliberately **do not** integrate Appeeky itself. It's a paid product; the brief explicitly suggests free-tier options and requires `npm install && npm run dev works`. Our Firecrawl + iTunes Search path covers what we can honestly observe.

## Limitations

- **iOS only.** Apple App Store URLs only. Google Play not supported.
- **Not scored:** iOS keyword field (hidden by Apple), full promotional-text history, A/B test data, Custom Product Pages, internal analytics. These either don't exist on the public listing or require App Store Connect access. They are flagged in the report rather than fabricated.
- **Single-session, in-memory state.** No persistence, no auth, no multi-user. Restart loses any in-progress workflow.
- **No eval harness.** Stays a strict MVP per the brief.

## Repository layout

```
.
├── apps/
│   ├── mastra/                          # Mastra service
│   │   └── src/
│   │       ├── mastra/index.ts          # Service entry; registers agent, workflow, route
│   │       ├── agents/aso-audit-agent.ts
│   │       ├── workflows/aso-audit-workflow.ts
│   │       ├── tools/
│   │       │   ├── fetch-app-metadata.ts
│   │       │   └── fetch-competitors.ts
│   │       ├── audit/
│   │       │   ├── compute-overall-score.ts
│   │       │   └── score.ts             # Structured-output + retry driver
│   │       ├── skills/
│   │       │   ├── aso-audit/SKILL.md
│   │       │   ├── metadata-optimization/SKILL.md
│   │       │   └── screenshot-optimization/SKILL.md
│   │       ├── scrape/
│   │       │   ├── firecrawl.ts         # Scraper interface + impl
│   │       │   ├── app-store-url.ts     # URL validation
│   │       │   ├── app-store-url.test.ts
│   │       │   └── itunes-search.ts     # Apple iTunes Search API client
│   │       ├── server/
│   │       │   ├── chat-route.ts        # POST /chat (NDJSON over Web Stream)
│   │       │   └── event-stream.ts
│   │       ├── model/nim.ts             # LLM factory
│   │       └── env.ts                   # Zod-validated env, fails fast
│   └── web/                             # Next.js App Router UI
│       ├── app/
│       │   ├── page.tsx                 # Chat page
│       │   ├── layout.tsx
│       │   ├── globals.css
│       │   └── api/agent/[...path]/route.ts   # Proxy to Mastra
│       ├── components/
│       │   ├── AuditReport.tsx
│       │   ├── ConfirmationCard.tsx
│       │   ├── ProgressStrip.tsx
│       │   └── ui/primitives.tsx
│       └── lib/
│           ├── use-agent-chat.ts        # Chat hook (NDJSON consumer)
│           └── event-stream.ts          # Web Streams NDJSON pipeline
├── packages/
│   └── shared/                          # Zod schemas + types (network contract)
└── openspec/                            # OpenSpec change docs

# Per-app env files (each loaded by its own runtime):
#   apps/mastra/.env        (mastra dev loads it; holds FIRECRAWL_API_KEY, LLM_*)
#   apps/web/.env.local     (next dev loads it; holds MASTRA_URL, WEB_PORT)
```

## Verification

A small URL-parser test script runs without external dependencies:

```bash
npm run test:url-parser --workspace apps/mastra
```

End-to-end verification needs a Firecrawl key + an LLM key and is documented in the OpenSpec `tasks.md` (sections 13.x). Run `npm run dev`, paste an App Store URL, and walk through the flow.

## Demo

A screen-recorded walkthrough is in [DEMO.md](./DEMO.md). _(To be recorded before submission.)_

## License + attribution

This repository is provided as a take-home submission. The vendored skill files under `apps/mastra/src/skills/` are derived from [Eronred/aso-skills](https://github.com/Eronred/aso-skills) (MIT). Each skill's frontmatter cites its upstream source and notes what was removed or refined.
