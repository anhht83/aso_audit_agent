## Context

Greenfield TypeScript repo. The take-home asks for a chat app: user pastes an Apple App Store URL, agent fetches surface metadata, asks "is this the app you meant?", and on confirmation runs a full ASO audit with progress visible, then renders a structured report.

The framework is fixed: **Mastra**. The brief explicitly wants idiomatic use of *agents, tools, workflows, and skills* — all four. The brief also leaves UI shell, LLM provider, and scraper as deliberate decisions.

Decisions already made with the user before this document:

- **UI:** Custom Next.js front-end (not the built-in Mastra playground).
- **Repo:** Monorepo with a separate Mastra service and Next.js app, orchestrated by a single root `npm run dev`.
- **LLM:** NVIDIA NIM via OpenAI-compatible client, with documented swap to OpenAI/Anthropic.
- **Scraper:** Firecrawl.
- **Mastra primitive map:** Tools = scraping. Skill = the ASO audit rubric. Workflow = confirm → audit with human-in-the-loop suspend/resume. Agent = orchestrator that owns the conversation.
- **Unavailable data:** Score what's observable on the public listing. Explicitly flag dimensions that require App Store Connect access (keyword field, promotional text history, A/B test data) rather than fabricating scores.
- **Streaming:** Agent token streaming plus workflow step events.
- **Scope:** Strict MVP. No eval harness, no caching layer, no extras.

The constraint that drives the design more than anything else: **`npm install && npm run dev` must work end-to-end, on apps the reviewer picks, with a complete `.env.example`**. Anything that adds setup friction or fragility is a real cost.

## Goals / Non-Goals

**Goals:**
- End-to-end chat: paste URL → confirmation → audit → rendered report, working on any valid Apple App Store URL.
- Idiomatic Mastra: tools, workflow with suspend/resume, skill, agent, all present and pulling weight.
- Honest audit. Every dimension declares its evidence basis. Anything not visible from the public listing is marked as such with no score fabricated.
- Streaming UX. Progress steps visible while the audit runs. Final report streams in token-by-token.
- Single-command boot: `npm install && npm run dev` at the repo root starts both services. `.env.example` lists every key the reviewer needs.
- Code quality of a senior TypeScript engineer: strict TS, narrow types at boundaries, Zod schemas on tool I/O, no dead abstractions, no speculative features.

**Non-Goals:**
- Authentication, persistence, multi-user. The chat is single-session, in-memory.
- Production deployment, CI, Docker, observability stack.
- Real-time price/rank scraping or paid ASO APIs (App Annie, Sensor Tower, etc.).
- Scoring the iOS keyword field, promotional text, or anything requiring App Store Connect access — these are explicitly flagged as not-visible.
- Apple Play Store / Google Play coverage. Apple App Store URLs only.
- Eval harness, caching, or any nice-to-haves beyond the brief.
- Custom design system. We will use Tailwind plus a small set of shadcn-style primitives we own outright.

## Decisions

### D1. Monorepo layout with two apps and a thin shared package

```
/
├── package.json              # root, npm workspaces, "dev" runs both concurrently
├── .env.example              # every key any package needs, documented
├── apps/
│   ├── mastra/               # Mastra service (HTTP + NDJSON stream)
│   │   └── src/
│   │       ├── index.ts      # boot Mastra server, register agents/workflows
│   │       ├── agents/aso-audit-agent.ts
│   │       ├── workflows/aso-audit-workflow.ts
│   │       ├── tools/
│   │       │   ├── fetch-app-metadata.ts
│   │       │   └── fetch-competitors.ts
│   │       ├── skills/aso-audit.skill.md
│   │       ├── scrape/firecrawl.ts
│   │       └── model/nim.ts  # NIM client, OpenAI-compatible
│   └── web/                  # Next.js 14 App Router
│       └── app/
│           ├── page.tsx      # chat UI
│           └── api/agent/[...path]/route.ts  # proxy to Mastra service
└── packages/
    └── shared/               # Zod schemas shared across the wire
        └── src/index.ts      # AppListing, AuditReport, ProgressEvent
```

**Rationale:** Two apps cleanly express the architectural seam (UI ↔ agent service). The shared package eliminates type drift on what's effectively the network contract. npm workspaces are the lowest-overhead monorepo tool that ships with the runtime — no Turborepo, no Nx, nothing the reviewer has to learn.

**Alternative considered:** Single Next.js app with Mastra mounted as API routes. Smaller diff, but Mastra's HTTP handler and streaming primitives are happier as their own process, and the brief's "idiomatic Mastra" leans toward running its server. User chose monorepo explicitly.

**Alternative considered:** Turborepo. Overkill. Two packages, one dev command, no build pipeline beyond `next build`.

### D2. Mastra primitive map

| Primitive | What it owns |
|---|---|
| **Tool: `fetchAppMetadata`** | Input: App Store URL (Zod-validated). Output: structured `AppListing`. Uses Firecrawl to scrape the listing page; parses out name, developer, category, country, icon URL, screenshot URLs, preview video URL, description, ratings, what's-new. |
| **Tool: `fetchCompetitors`** | Input: category + country + the subject app's `appId`. Output: array of `CompetitorSummary` (up to 3, excluding subject). Sources baseline fields from Apple's free iTunes Search API; enriches with one Firecrawl scrape per competitor to fill `screenshotCount` and `hasPreviewVideo`. We deliberately return the lighter summary shape rather than full `AppListing` for each competitor - the audit's comparison table only needs the summary fields, and three full scrapes per audit would burn through Firecrawl's free tier in a few demo runs. |
| **Skill: `aso-audit` (primary)** | A Markdown skill file containing the full audit rubric, the ten dimensions and weights, the output format (Score Card, Quick Wins, High-Impact, Strategic, Competitor Comparison), and the explicit "what's not visible" policy. Vendored and refined from `Eronred/aso-skills` (see D11). Loaded by the agent at audit time. |
| **Skill: `metadata-optimization` (sub-skill)** | Vendored from `aso-skills`, trimmed of Appeeky-dependent steps. Loaded by the audit agent on demand when generating before/after text for title/subtitle/description recommendations. |
| **Skill: `screenshot-optimization` (sub-skill)** | Vendored from `aso-skills`, trimmed of Appeeky-dependent steps. Loaded by the audit agent on demand when generating screenshot recommendations. |
| **Workflow: `asoAuditWorkflow`** | Two steps: `resolveListing` (calls `fetchAppMetadata`, returns `AppListing`, then `suspend`s for user confirmation) and `runAudit` (resumes with confirmation, calls `fetchCompetitors`, invokes the agent with the `aso-audit` skill to produce the final `AuditReport`). Emits step events the UI streams. |
| **Agent: `asoAuditAgent`** | Orchestrator. Owns the chat. On first turn: extracts URL, invokes workflow. Receives suspended state, asks user to confirm. On user yes/no, resumes the workflow. On no, asks user to paste a different URL. Streams the final audit. |

**Rationale:** Every primitive does work that only it can do. Tools = side-effectful I/O with typed contracts. Skills = the domain knowledge as content (the audit rubric is exactly the kind of thing skills exist for; it's reusable, editable as prose, and version-controllable separately from code). Workflows = the multi-step process with the human-in-the-loop pause. Agents = the conversational seam.

**Alternative considered:** Skip the skill, bake the rubric into the agent's system prompt. Simpler. Rejected because the brief explicitly mentions skills, and a 1500-word rubric is exactly the content skills were designed for.

**Alternative considered:** Make `fetchCompetitors` a workflow step rather than a tool. Either is defensible. As a tool, it's reusable from any future agent and stays inside the typed-tool contract. Kept as a tool.

### D3. Audit output is a typed object, not free-form Markdown

`AuditReport` is a Zod schema with:
- `overallScore: number` (0-100, computed deterministically from dimensions)
- `dimensions: Dimension[]` where each dimension has `name`, `weight`, `score` (0-10 or `null` for not-visible), `evidence: string`, `reasoning: string`, `visibility: "observable" | "not-visible-from-public-listing"`
- `quickWins: Recommendation[]`, `highImpact: Recommendation[]`, `strategic: Recommendation[]`
- `competitorComparison: CompetitorComparison`

Each `Recommendation` has `title`, `evidence`, `before?`, `after?`, `rationale`.

The agent emits this via structured generation (`generateObject` or tool-call-as-output). The UI then renders it however it wants. The overall score is computed in TypeScript from weighted dimension scores, *not* asked of the LLM, so it can't drift.

**Rationale:** A typed object decouples the model output from the UI rendering, eliminates a class of parsing bugs, lets us guarantee the math, and lets the UI render score bars / tables / before-after diffs as real components. Free-form Markdown rendering would look fine but would be brittle and would make "nice to look at" depend on the LLM's typographic taste.

**Alternative considered:** Have the agent emit Markdown directly. Rejected: harder to validate, harder to render consistently, easy for the model to silently skip a dimension or invent the overall score.

### D4. NVIDIA NIM via OpenAI-compatible client; model swap via env

A single `model/nim.ts` exports a `model()` factory that reads `LLM_PROVIDER` (default `nim`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` from env and returns a Mastra-compatible model instance. To swap to OpenAI or Anthropic, the reviewer changes env values; README documents the exact values.

NIM model default: a current chat-completions model with tool/structured output support, named in `.env.example` with a comment.

**Rationale:** Honors the brief's suggestion of NIM, keeps the swap one-line, and documents it. No provider lock-in.

**Risk:** NIM free tier rate-limits or transient flakes during the demo. Mitigation: documented fallback in README, and the env swap is genuinely one variable.

### D5. Streaming contract between Mastra and Next.js

The Next.js app exposes `POST /api/agent/chat` (proxy) and forwards Mastra's stream verbatim as a newline-delimited JSON body (`application/x-ndjson`). Two event types over the wire:

- `progress` — workflow step lifecycle: `{ step: "resolveListing" | "fetchCompetitors" | "scoring", status: "started" | "completed", data?: ... }`. Used for the "Fetching metadata..." → "Scraping competitors..." → "Scoring dimensions..." progress strip.
- `message` — agent text chunks (streamed tokens) and the final `AuditReport` payload as a single `message` with `kind: "audit-report"`.

The Next.js client decodes the NDJSON stream with a Web Streams pipeline (`response.body.pipeThrough(new TextDecoderStream()).pipeThrough(splitLines).pipeThrough(parseJson)`), updates a progress bar from `progress` events, appends streamed text to the current assistant bubble, and when an `audit-report` arrives, renders the structured report component instead of text.

**Rationale:** Two event types is the minimum that supports the UX. Mastra's own streaming primitives emit both; we expose them as-is.

**Why NDJSON over SSE:** SSE's actual features — event IDs, named events, automatic browser reconnect — buy us nothing here. We're streaming typed JSON objects in one direction over a single request, no reconnect semantics needed. NDJSON over a plain `ReadableStream` keeps the server writer to ~50 lines, lets the client decode through standard Web Streams primitives with back-pressure for free, and avoids hand-rolling `data:` framing and a blank-line state machine on the client. The wire format is a single `JSON.stringify(event) + '\n'` per write; the client reads it as `response.body.pipeThrough(TextDecoderStream).pipeThrough(splitLines).pipeThrough(parseJson)`.

### D6. Confirmation step uses Mastra workflow suspend/resume, not an in-agent question

The orchestrator agent extracts the URL, kicks off the workflow. After `resolveListing` runs, the workflow `suspend`s with the `AppListing` as suspend data. The orchestrator agent receives the suspended state, presents the listing card to the user ("Is this the app you meant?"), and on user reply resumes the workflow with `{ confirmed: true | false }`.

**Rationale:** This is the canonical Mastra pattern for human-in-the-loop. Doing the confirmation purely inside the agent's loop would work but would miss the chance to demonstrate workflow suspension, which is one of Mastra's headline features.

**Trade-off:** Slightly more wiring than a pure agent loop. Worth it for the brief's "idiomatic Mastra" judgment criterion.

### D7. Handling data we can't see

For each of the ten dimensions, we declare `visibility`:
- **Title, Subtitle, Description, Screenshots, App preview video, Ratings & reviews, Icon, Conversion signals (What's New + promo text when visible)** → observable on the public listing.
- **iOS keyword field (100 chars)** → not visible. Always rendered as "Requires App Store Connect access" with no score, but with a *recommendation* about keyword research methodology.
- **Promotional text history, In-App Events history, A/B test data** → mostly not visible. We score what's visible *right now* on the listing (current promo text appears in the description preamble; current IAE appears on the listing if active).
- **Competitive position** → observable via competitor scrape.

Not-visible dimensions contribute zero to the overall score and the weights of observable dimensions are *renormalized* so the overall score still totals 100. Both the raw weighted score and the renormalized score are shown in the UI, with a note explaining the renormalization.

**Rationale:** Honest. The reviewer will run this against real apps and notice if we fabricate a keyword-field score. Renormalization preserves the 0-100 readability without making us liars.

### D8. Strict types, narrow boundaries, no exception swallowing

- TypeScript strict mode. `noUncheckedIndexedAccess: true`.
- Zod at every external boundary: tool input/output, env config, the `AuditReport` schema produced by the LLM (parsed and validated; on parse failure, retry once with the error fed back).
- Fetch errors from Firecrawl surface to the user with a specific message ("Couldn't fetch the App Store listing — is the URL correct?"). They do not get silently turned into empty data.
- LLM errors surface the same way. No "best-effort partial audit."

### D9. URL validation

We validate Apple App Store URLs against a small allowed shape: hostname ends in `apps.apple.com`, path matches `/<country>/app/<slug>/id<digits>`. We extract `country` and `appId` from the URL for use in scraping. Anything else gets rejected before we hit Firecrawl, with a clear message.

**Rationale:** Cheap, prevents wasted Firecrawl calls, gives the reviewer a clean failure mode if they paste a Google Play URL or a generic apps.apple.com homepage.

### D11. Source of the audit skill: refined vendor from `Eronred/aso-skills`

The brief states that its ASO rubric was "adapted from the open-source aso-skills project." We treat that as a deliberate pointer rather than a coincidence and adopt the upstream skill as our base, with refinements.

Specifically: we copy `skills/aso-audit/SKILL.md` from `Eronred/aso-skills` (MIT) into `apps/mastra/src/skills/aso-audit/SKILL.md`, then reconcile it against the brief's table so the weights and dimension list match what the reviewer expects. The notable reconciliations:

- **Description weight:** brief is flat 10%; upstream is 5% iOS / 15% Android. We adopt 10% (iOS-only audit).
- **"Keyword Rankings" dimension (10%) in upstream → "Competitive position" (5%) in the brief.** The brief's weighting also adds 5% back to a different dimension. We adopt the brief's set: "Competitive position" 5%, no separate "Keyword Rankings" line. We can actually observe competitive position via scrape; we cannot observe keyword rankings without App Store Connect or a paid API, so this swap also aligns with D7 (visibility policy).
- **Visibility / renormalization section:** we add a new section to the skill spelling out which dimensions are observable from the public listing and that non-observable ones produce `score: null` and renormalize the overall.

Frontmatter retains the original `name`, adds a `source` field pointing to the upstream file and the MIT license, and a `derivedFrom` note. README adds a one-line credit.

**Rationale:** The brief is going to be scored partly on whether we engaged thoughtfully with what they pointed us at. Pretending we wrote the rubric from scratch would either look naive (if the reviewer notices) or low-integrity (if they ask). Citing the source and showing what we changed and why is the senior-engineer move.

**Alternative considered:** Vendor verbatim and just live with the weight drift. Rejected — the brief gave an explicit table, and matching it exactly is cheap.

**Alternative considered:** Write our own rubric from scratch citing aso-skills as inspiration. Rejected — too much paraphrasing risk, no upside.

### D12. Selective sub-skill adoption; explicitly skip Appeeky

We vendor exactly three skill files from `aso-skills`:

1. `aso-audit` — primary, always loaded by the audit agent.
2. `metadata-optimization` — loaded by the audit agent when emitting a recommendation that requires generating before/after text for title, subtitle, description, or promotional text.
3. `screenshot-optimization` — loaded when emitting a screenshot-related recommendation.

We do **not** vendor `keyword-research`, `competitor-analysis`, `aso-router`, or any of the other 25-plus skills. Reasons:

- Most of them assume the **Appeeky MCP** is connected and that the agent has access to live keyword volume, difficulty, and rank data. Without Appeeky we'd either fabricate the data (dishonest) or strip so much from the skill it becomes a stub (worse than not having it).
- More skills = more surface area for the agent to load the wrong one at the wrong time = more variance in output quality during a take-home demo.
- The brief asks for *idiomatic* skill use, not maximal skill use.

The two sub-skills we keep are loaded on demand by the audit agent based on the dimension currently being addressed (the agent emits the audit, then for each metadata- or screenshot-flavored recommendation it can consult the matching skill for before/after generation guidance).

Vendored sub-skills are trimmed: any reference to Appeeky API calls, keyword rank lookups, or download estimates is removed. The frameworks, scoring rubrics, and templates are kept.

**Trade-off:** Trimming third-party prose risks drifting from upstream. Mitigation: each vendored file's frontmatter records its commit SHA and date, so anyone can diff against upstream.

**Why not integrate Appeeky directly?** It's a paid product. The brief specifies `npm install && npm run dev works` and lists free-tier suggestions; requiring the reviewer to sign up for a paid service breaks that contract. Our Firecrawl scraper covers what we can honestly observe.

### D10. README and `.env.example` are deliverables, not afterthoughts

`.env.example` documents every variable: `FIRECRAWL_API_KEY`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, port settings if any. Each with a one-line comment.

README sections: Quickstart (3 commands), Architecture (the Mastra primitive map from D2 in one diagram or table), Decisions (a short list of the calls we made and why — UI choice, monorepo, NIM, Firecrawl, the not-visible-data honesty policy), Limitations (what we don't measure and why), Demo (link to the screen recording).

## Risks / Trade-offs

- **NIM free-tier flakiness during demo** → Mitigation: README documents swap to OpenAI in two env-var changes. Optional: record the demo against OpenAI to be safe and note the NIM compatibility in the README.
- **Firecrawl rate limits or schema drift on App Store pages** → Mitigation: tool returns a structured error the agent surfaces to the user verbatim. We do not hide failures. We can also fall back to plain `fetch` + a basic HTML parser for the listing page (Apple App Store listings are largely SSR), kept as a documented but unimplemented fallback unless we hit issues.
- **LLM produces a malformed `AuditReport`** → Mitigation: Zod parse, one retry with the validation error in-context. Strict structured generation via the model's native JSON mode. Hard fail with a clear message on second failure.
- **Competitor scrape is the most fragile part** → Mitigation: if competitor fetch fails, the audit still runs and the competitor section is rendered as "Competitor data unavailable — try again or scope this audit to the subject app only." The audit does not fail wholesale.
- **App Store HTML changes between when we ship and when the reviewer runs it** → Real risk we can't fully eliminate. Mitigation: rely on Firecrawl's LLM extract feature with a Zod schema rather than CSS selectors, so the extractor adapts to minor markup changes.
- **`npm install && npm run dev` not actually working on the reviewer's machine** → Mitigation: a manual checklist run on a clean clone before submission. README lists Node version. No global tools required.
- **Demo recording reveals a bug we missed** → Mitigation: record after the manual checklist. Re-record if anything breaks.
- **Vendored aso-skills sub-skills drift toward Appeeky-assuming language** → Mitigation: each vendored file is read end-to-end during the vendoring task and trimmed; commit SHA recorded in frontmatter so the diff is auditable.

## Implementation risk mitigations (post-write)

A few risks were called out after the first implementation pass. Each was resolved by reading the actual TypeScript definitions from the relevant published packages and rewriting the suspect code against the real types, rather than guessing from docs. Pinned versions:

- `@mastra/core@1.36.0`, `mastra@1.10.0`
- `@mendable/firecrawl-js@4.24.2`
- `zod@^4.4.0`, `zod-to-json-schema@^3.25.0`

| Risk (original) | Concrete resolution |
|---|---|
| Mastra workflow `suspendData` access shape | Verified `ExecuteFunctionParams` in `@mastra/core/workflows`. `suspendData` is a real destructurable param on resume, populated automatically with the original `suspend()` argument. Workflow step uses it directly; no `getWorkflowRunById` plumbing needed. |
| `getWorkflowRunById` response shape for reading suspend payload + final result | Stopped using it. The awaited `WorkflowRunOutput.result` IS a `WorkflowResult` discriminated union with `status` ∈ {`success`, `suspended`, `failed`, …}; on suspend it carries `suspendPayload` directly. Chat route reads that, no second lookup. |
| `workflow.stream()` return shape | `run.stream()` returns `WorkflowRunOutput` synchronously (no `await`). It exposes `.fullStream: ReadableStream<WorkflowStreamEvent>` for iteration and `.result: Promise<WorkflowResult>` for the final state. Chat route updated to call both. |
| Writer payloads arriving as raw events | They don't. `writer.write({...})` payloads arrive wrapped in `WorkflowStreamEvent` chunks of type `'workflow-step-output'`, with the payload at `chunk.payload.output`. Chat route now `unwrapStepOutput`s each chunk and validates against `streamEventSchema` before forwarding. |
| Firecrawl SDK API shape | `@mendable/firecrawl-js@4.24.2` exports `Firecrawl` as default (not `FirecrawlApp` — that's the v1 alias). `client.scrape(url, opts)` returns `Document` with `.json` set when `formats: [{ type: 'json', schema }]` is requested. Errors surface as `SdkError` with `.status`. Scraper rewritten accordingly. |
| Zod 4 vs Firecrawl's bundled Zod 3 | Firecrawl's `JsonFormat.schema` accepts `Record<string, unknown>` OR `ZodTypeAny`, but the bundled validator is Zod 3 and our schemas are Zod 4. We convert at the boundary with `zod-to-json-schema` (which peer-supports `^3.25.28 \|\| ^4`) and hand Firecrawl a plain JSON Schema. The original Zod 4 schema still validates the response. |
| Calling Mastra tool `.execute()` directly from workflow steps | Removed. The scrape and competitor lookup logic now lives in plain async functions (`scrape/fetch-listing.ts`, `scrape/fetch-competitor-list.ts`). The Mastra tools (`fetch-app-metadata`, `fetch-competitors`) are thin wrappers around those functions; workflow steps call the functions directly. No `ToolExecutionContext` synthesis, no `as any` casts. |
| Agent structured output option key | The Mastra v1 option is `structuredOutput: { schema }`, NOT `output`. The parsed value is at `response.object`, not `response.value`. Both call sites updated in `audit/score.ts`. |
| Workspace skills path resolution | `LocalFilesystem.basePath` set to `apps/mastra/src/` (resolved from `import.meta.url`, CWD-independent); `skills: ['skills']` is the relative subdirectory. Matches the canonical example in Mastra's skills docs. |

## Migration Plan

N/A — greenfield. Deploy = the reviewer running `npm install && npm run dev`. Rollback = `git stash`.

## Open Questions

- Which exact NIM model to default to. Resolved at implementation by picking a current tool-calling-capable model from `build.nvidia.com` and pinning it in `.env.example` with a comment.
- Whether to include a small `samples/` directory with 2-3 captured `AuditReport` JSONs for known apps, so the reviewer can sanity-check rendering without burning LLM quota. Out of strict-MVP scope per user, but cheap. Decide during implementation.
