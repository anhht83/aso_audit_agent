## 1. Monorepo scaffold and tooling

- [x] 1.1 Initialize npm workspaces at the repo root with workspaces `apps/*` and `packages/*`
- [x] 1.2 Add root `package.json` with a `dev` script that runs both apps concurrently (use `concurrently` or `npm-run-all`), `lint`, `typecheck`, and `build` scripts that fan out to workspaces
- [x] 1.3 Add `tsconfig.base.json` with strict mode, `noUncheckedIndexedAccess`, `moduleResolution: bundler`, target ES2022
- [x] 1.4 Add `.gitignore` covering `node_modules`, `.env`, `.next`, `dist`, build artifacts
- [x] 1.5 Add `.env.example` at the repo root with `FIRECRAWL_API_KEY`, `LLM_PROVIDER` (default `nim`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `MASTRA_PORT`, `WEB_PORT`, each with a one-line comment
- [x] 1.6 Add root `.editorconfig` and a single `prettier` config; no ESLint beyond what Next.js ships

## 2. Shared package (`packages/shared`)

- [x] 2.1 Create `packages/shared` with its own `package.json` exporting from `src/index.ts`
- [x] 2.2 Define and export `AppListing` Zod schema covering all fields in `app-store-ingest` spec
- [x] 2.3 Define and export `Dimension`, `Recommendation`, `CompetitorComparison`, and `AuditReport` Zod schemas covering the `aso-audit` spec, including the `visibility` enum
- [x] 2.4 Define and export `ProgressEvent` and `ChatMessage` (with `kind: "audit-report" | "text" | "confirmation"`) schemas for the streaming contract from `audit-conversation`
- [x] 2.5 Export inferred TypeScript types alongside each Zod schema

## 3. Mastra service (`apps/mastra`) - bootstrap

- [x] 3.1 Create `apps/mastra` with `package.json`, depending on `mastra`, `@mastra/core`, `zod`, an OpenAI-compatible client (e.g. `@ai-sdk/openai` or whichever Mastra's current model adapter prefers), and the local `shared` workspace package. The Firecrawl integration uses the v2 HTTP API directly via `fetch` — no SDK dependency.
- [x] 3.2 Add a `tsconfig.json` extending the root base, plus a `dev` script that runs the Mastra server on `MASTRA_PORT` with hot reload
- [x] 3.3 Add `src/env.ts` that validates required env vars with Zod at startup and fails fast with a clear error referencing `.env.example` if any are missing (per `app-store-ingest` "Missing API key fails fast at startup")
- [x] 3.4 Add `src/model/nim.ts` exporting a `model()` factory keyed on `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`, returning a Mastra-compatible model. Document the OpenAI swap in a comment.

## 4. Scraper module (`apps/mastra/src/scrape`)

- [x] 4.1 Add `src/scrape/scraper/` (folder) — `scraper/types.ts` exports the typed `Scraper` interface and its `ScrapeOptions`/`ScrapeSuccess`/`ScraperError` shapes; `scraper/firecrawl.ts` holds the Firecrawl implementation that takes URL + Zod extraction schema and returns parsed data or a typed error; `scraper/index.ts` exports the singleton chosen impl. The generic `Result<T, E>` primitives live one level up in `src/scrape/types.ts` because non-scraper code (URL parser, iTunes search) also depends on them.
- [x] 4.2 Add `src/scrape/app-store-url.ts` exporting `parseAppStoreUrl(url)` that validates the URL shape and returns `{ country, appId, slug }` or a typed error, per the `app-store-ingest` URL validation requirement
- [x] 4.3 Add unit-test-style sanity checks (in-file `if (require.main)` or a small `tsx` script) covering 2-3 valid and 2-3 invalid URLs; document how to run

## 5. Scrape functions (`apps/mastra/src/scrape`)

- [x] 5.1 Implement `fetchListing(url)` in `scrape/fetch-listing.ts`: calls `parseAppStoreUrl`, then `Scraper.extract` against the listing page with a Zod schema mirroring `AppListing`. Returns typed failure on scrape error. Called directly from the workflow's `resolveListing` step; no Mastra tool wrapper.
- [x] 5.2 Implement `fetchCompetitorList({ category, country, excludeAppId, limit })` in `scrape/fetch-competitor-list.ts`: returns `{ competitors: CompetitorSummary[], warning?: string }`. Uses Apple's iTunes Search API for the candidate list, enriches each via one Firecrawl call. Filters out the subject, returns up to `limit`. Returns empty array with `warning` on failure rather than throwing. (Spec updated: returns `CompetitorSummary` instead of full `AppListing` to keep free-tier scraping budget reasonable.) Called directly from the workflow's `runAudit` step; no Mastra tool wrapper.
- [x] 5.3 Both functions log only their high-level status (no token-streaming); errors propagate as typed return values.

## 6. Audit skill (`apps/mastra/src/skills`)

- [x] 6.1 Vendor `Eronred/aso-skills` `skills/aso-audit/SKILL.md` into `apps/mastra/src/skills/aso-audit/SKILL.md`. Reconcile the rubric to match the brief's exact table: Description = 10% (flat), replace upstream's "Keyword Rankings" 10% with the brief's "Competitive position" 5% and add the remaining 5% to match the brief's weights. Add a "Visibility and Renormalization" section spelling out our public-listing-only policy. Preserve attribution in frontmatter (`source`, MIT, commit SHA).
- [x] 6.2 Verify the skill is registered/loaded by the agent at audit time (per the `aso-audit` "Skill is loaded by the audit agent" scenario) and that no rubric content is duplicated in any TypeScript file _(deferred to pass 7 - skill registration happens with the Workspace setup)_
- [x] 6.3 ~~Vendor `metadata-optimization` and `screenshot-optimization` SKILL.md files~~ **Dropped.** We initially vendored both as on-demand sub-skills, but the audit agent's main instructions already cover before/after generation for metadata and screenshot recommendations. The extra files were redundant prose; removed for less load-the-wrong-skill variance. See design D12.
- [x] 6.4 ~~Wire the audit agent to load the matching sub-skill on demand~~ **Dropped along with 6.3.** Only `aso-audit` is loaded.

## 7. Audit agent and scoring (`apps/mastra/src/agents`)

- [x] 7.1 Implement `asoAuditAgent`: scoring agent (separate from the orchestrator that owns the chat) - bound to model from `src/model/nim.ts`. Loads the `aso-audit` skill via Workspace.
- [x] 7.2 Implement the LLM scoring call: `src/agents/aso-audit/scorer/index.ts` - `runAudit()` takes an `AppListing` plus competitor `CompetitorSummary[]` and produces an `AuditReport` via `asoAuditAgent.generate({ output: llmAuditOutputSchema })`. The driver attaches the listing and the deterministic overall score before returning.
- [x] 7.3 Add `src/agents/aso-audit/scorer/compute-overall-score.ts` that takes the scored dimensions and returns the renormalized `overallScore` (sum over observable dimensions only, rescaled to 100).
- [x] 7.4 Implement the Zod-validate-with-one-retry loop for `AuditReport` per the `aso-audit` spec; surface a typed error (`AuditScoringError`) after two failures.

## 8. Workflow (`apps/mastra/src/workflows`)

- [x] 8.1 Implement `asoAuditWorkflow` step `resolveListing`: input `{ url }`, calls `fetchListing`, then `suspend`s with the resolved `AppListing` as suspend data
- [x] 8.2 Implement step `runAudit` triggered on resume: branches on `confirmed`; if false, terminates with a "user rejected listing" outcome; if true, emits a `fetchCompetitors` progress start, calls `fetchCompetitorList`, emits complete, emits a `scoring` progress start, calls the audit agent's scoring path, emits complete, computes `overallScore`, returns the final `AuditReport`
- [x] 8.3 Wire workflow step lifecycle events to a `progress` event stream via the step `writer` argument, consumed by the Mastra HTTP handler
- [x] 8.4 The three named progress events (`resolveListing`, `fetchCompetitors`, `scoring`) fire via explicit `writer.write({ type: 'progress', step, status })` calls in order. Verification scenario coverage is satisfied by the spec scenario plus the explicit ordering in code.

## 9. Mastra HTTP / streaming surface

- [x] 9.1 Stand up the Mastra HTTP server in `apps/mastra/src/mastra/index.ts` (the convention `mastra dev` looks for), registering the agent, the workflow, and a Workspace for skill discovery
- [x] 9.2 Expose a chat endpoint (`POST /chat`) via `registerApiRoute()` that the Next.js app proxies to, accepting `{ kind: 'start', text }` for a fresh audit or `{ kind: 'resume', resumeToken, confirmed }` to advance a suspended workflow
- [x] 9.3 Emit `StreamEvent`s as newline-delimited JSON (`application/x-ndjson`) over a `ReadableStream`: `progress` (workflow step lifecycle) and `message` (confirmation card, error, text, or final audit-report), conforming to the `@aso/shared` schemas. Chose NDJSON over SSE because we don't need SSE-specific features (event IDs, retry, named events) and Web Streams primitives give back-pressure for free on both sides.

## 10. Next.js front-end (`apps/web`) - bootstrap

- [x] 10.1 Create `apps/web` as a Next.js 14 App Router app with TypeScript, Tailwind CSS, depending on the local `shared` workspace package
- [x] 10.2 `MASTRA_URL` is documented in root `.env.example` and read by the proxy route. The reviewer copies the root `.env.example` to `.env`; Next.js picks it up via the standard process.env loading.
- [x] 10.3 Add `app/api/agent/[...path]/route.ts` that proxies POST + GET to the Mastra service, preserving the streaming response body and content-type
- [x] 10.4 Add a minimal Tailwind theme and a small set of UI primitives (Button, Card, Bar, Pill) under `components/ui/` - kept inline, no shadcn install step

## 11. Chat UI

- [x] 11.1 Build `app/page.tsx` with a chat layout: message list, input box, send button, in-flight loading state
- [x] 11.2 Implement a client-side hook `useAgentChat` that POSTs user messages to `/api/agent/...`, parses the NDJSON response via a Web Streams pipeline (`TextDecoderStream` → split lines → `JSON.parse`), and dispatches `progress` events to a progress store and `message` events into the chat list
- [x] 11.3 Render text messages as plain-text bubbles; render `audit-report` messages with the dedicated `AuditReport` component (see task 12). _(Plain text rather than Markdown - the audit content lives in `audit-report`, so text turns are short status/cancellation strings.)_
- [x] 11.4 Implement the confirmation card: when the latest message kind is `confirmation` (sent by the agent on workflow suspend), render the listing card with "Yes, audit this" and "No, wrong app" buttons that POST the confirmation back to the agent. Typed "yes"/"no" replies route through `sendWithConfirmationFallback`.
- [x] 11.5 Implement the progress strip: ordered list of "Fetching app metadata", "Scraping competitors", "Scoring dimensions"; each item reflects the latest `progress` event; collapses after the audit report arrives

## 12. Audit report rendering

- [x] 12.1 Build an `<AuditReportView>` React component (in `components/AuditReport.tsx`) that takes a parsed `AuditReport` and renders all sections per the `audit-ui` spec
- [x] 12.2 Implement the score card: prominent overall score out of 100, then a per-dimension list. Observable dimensions show a progress bar and `score / 10`. Non-observable dimensions show a "Requires App Store Connect" treatment with the reasoning text.
- [x] 12.3 Implement the three recommendation sections (Quick Wins, High-Impact Changes, Strategic) as cards listing title, evidence, rationale, and a visually distinguished before/after block when present
- [x] 12.4 Implement the competitor comparison table; render the summary string standalone when the competitors list is empty
- [x] 12.5 Render service errors as inline assistant error messages (red treatment), keep the input usable

## 13. Glue: end-to-end manual verification

- [ ] 13.1 _(HUMAN-ONLY - cannot be run in the implementation environment.)_ On a clean clone, run `npm install && cp .env.example .env`, fill in keys, run `npm run dev`. Verify both services start and the UI loads.
- [ ] 13.2 _(HUMAN-ONLY.)_ Run the Spotify URL from the brief end-to-end: paste, see confirmation card, click yes, watch progress strip update, receive a rendered audit report with non-empty quick wins, before/after on the title, and a competitor table
- [ ] 13.3 _(HUMAN-ONLY.)_ Run a second URL the implementer hasn't tested before (e.g. a small indie app). Verify it works and any unavailable data is gracefully flagged.
- [ ] 13.4 _(HUMAN-ONLY.)_ Run a deliberately broken URL (Google Play link, malformed Apple URL). Verify the validation error renders inline and the input remains usable.
- [ ] 13.5 _(HUMAN-ONLY.)_ Run a URL whose scrape will fail (e.g. an unpublished/region-blocked app). Verify the error renders inline rather than producing a partial audit.

## 14. README and demo

- [x] 14.1 Write `README.md` with Quickstart (`npm install`, copy `.env.example`, `npm run dev`), required Node version, and a one-table summary of the Mastra primitive map
- [x] 14.2 Add a "Decisions" section to the README covering: monorepo with Next.js front-end and Mastra service, NIM as default LLM with swap path, Firecrawl for scraping, the not-visible-data honesty policy, deterministic overall-score computation, and the rubric source (adapted from `Eronred/aso-skills`, MIT) including the deliberate choice **not** to integrate Appeeky
- [x] 14.3 Add a "Limitations" section calling out exactly which audit dimensions are non-observable and why
- [ ] 14.4 Record a screen capture walking through the build end-to-end, narrating the architecture and demoing the audit on at least one app. Link it in the README. _(HUMAN-ONLY - cannot be done from the implementation environment.)_

## 15. Submission

- [ ] 15.1 _(HUMAN-ONLY - requires `npm install` having run successfully against the real registry.)_ Final pre-submit checklist: typecheck across workspaces passes, lint passes, dev server boots clean, `.env.example` is complete, no leftover keys committed, README links work
- [ ] 15.2 _(HUMAN-ONLY.)_ Push to a private GitHub repo and invite `@mikekhristo` as a collaborator
