## Why

The take-home asks for a TypeScript chat app where a user pastes an Apple App Store URL and gets back a real ASO audit. There is no existing code in this repo. We need to ship a working end-to-end MVP that demonstrates idiomatic Mastra usage (agents, tools, workflows, skills) and reads as something a senior TypeScript engineer would ship.

## What Changes

- Add a Mastra service that fetches App Store listing metadata, asks the user to confirm the app, then runs a full ASO audit and returns a structured report.
- Add a Next.js front-end that renders the chat, the confirmation step, live progress while the audit runs, and the final audit card.
- Add a Firecrawl-backed App Store scraper covering the listing page and same-category top-charts for competitor lookup.
- Add an LLM-driven scorer that scores ten audit dimensions on Apple's public-facing surface and explicitly flags dimensions that require App Store Connect access we do not have (keyword field, promotional text, A/B data).
- Adopt the audit rubric and supporting prose from [`Eronred/aso-skills`](https://github.com/Eronred/aso-skills) (MIT) — the same open-source project the brief itself was adapted from. Vendor three skill files: `aso-audit` (refined to match the brief's exact rubric table and our visibility policy), plus `metadata-optimization` and `screenshot-optimization` (trimmed of Appeeky-dependent steps) for use when the audit agent emits those recommendation types. Do **not** integrate the Appeeky MCP server — keep our Firecrawl scraper as the data source.
- Wire the LLM to NVIDIA NIM via Mastra's OpenAI-compatible model config, with a documented swap path to OpenAI or Anthropic.
- Provide a single root `npm install && npm run dev` that launches both services concurrently, plus a complete `.env.example` and a README documenting setup and the deliberate decisions left to us.

## Capabilities

### New Capabilities
- `app-store-ingest`: Resolve an Apple App Store URL into structured listing metadata (name, developer, icon, category, country, screenshots, preview video, description, ratings) and fetch top-N same-category competitors. Owns scraping concerns and provider abstraction.
- `aso-audit`: Score a resolved listing across the ten ASO dimensions on a 0-10 scale, compute a weighted overall score out of 100, generate prioritized recommendations (quick wins, high-impact, strategic) with before/after text examples, and produce a competitor comparison. Owns the audit rubric as a Mastra skill and the scoring agent.
- `audit-conversation`: Two-phase chat conversation - URL intake and listing confirmation, then audit execution with streamed progress and a final rendered report. Owns the Mastra workflow (confirm → audit) with human-in-the-loop suspend/resume, the orchestrator agent, and the streaming contract consumed by the UI.
- `audit-ui`: Next.js chat front-end that consumes the Mastra service over an NDJSON stream (`application/x-ndjson`), renders the confirmation card, streams workflow progress events and agent tokens, and renders the final audit (score bars, recommendation sections, competitor table, before/after diffs).

### Modified Capabilities
<!-- None. Greenfield repo. -->

## Impact

- New code only. No existing capabilities or APIs to modify.
- New runtime dependencies: Mastra, Next.js, Firecrawl SDK, an OpenAI-compatible client targeting NVIDIA NIM, Zod for tool schemas.
- New external services: NVIDIA NIM (LLM), Firecrawl (scraping). Both have free tiers and are accessed via API key in `.env`.
- Repo structure becomes a monorepo workspace with two packages (`apps/mastra`, `apps/web`) and a root script orchestrating both for `npm run dev`.
- Three vendored skill files live under `apps/mastra/src/skills/` with attribution preserved in their frontmatter and a README acknowledgement crediting `Eronred/aso-skills` (MIT).
- No existing tests, CI, or deployment to disturb.
