## ADDED Requirements

### Requirement: Audit rubric is owned by a Mastra skill

The system SHALL store the ASO audit rubric — the ten dimensions, their weights, the per-dimension key checks, the output format, and the not-visible-data policy — as a Mastra skill file loaded by the audit agent on demand.

The skill SHALL be the single source of truth for audit instructions. The agent's system prompt MUST NOT duplicate the rubric content.

#### Scenario: Skill is loaded by the audit agent
- **WHEN** the audit step of the workflow runs
- **THEN** the audit agent loads the `aso-audit` skill before generating the report
- **AND** the rubric content is present exactly once in the codebase, in the skill file

#### Scenario: Editing the rubric does not require code changes
- **WHEN** a developer changes a weight or a key check in the skill file
- **THEN** the next audit run reflects the change with no TypeScript code modifications

#### Scenario: Vendored skills retain attribution
- **WHEN** any skill file under `apps/mastra/src/skills/` was sourced from `Eronred/aso-skills`
- **THEN** its frontmatter includes a `source` field pointing to the upstream file and references the MIT license
- **AND** the project README credits `Eronred/aso-skills` as the rubric source

### Requirement: Score ten dimensions on a 0-10 scale with declared visibility

The system SHALL score the listing on each of these ten dimensions: Title, Subtitle, Keyword field, Description, Screenshots, App preview video, Ratings & reviews, Icon, Conversion signals, Competitive position.

Each dimension result MUST include: `name`, `weight` (matching the rubric percentages: 20/15/15/10/15/5/15/5/5/5), `score` (a number 0-10, or `null` if not observable), `evidence` (specific data point cited from the listing), `reasoning` (one-to-three sentences explaining the score), and `visibility` (one of `"observable"` or `"not-visible-from-public-listing"`).

Dimensions whose data is not exposed on the public listing — at minimum the iOS Keyword field — MUST have `score: null` and `visibility: "not-visible-from-public-listing"`. The system SHALL NOT fabricate a score for these dimensions.

#### Scenario: Title is scored with cited evidence
- **WHEN** the audit runs on a real listing
- **THEN** the Title dimension result has a numeric `score` between 0 and 10
- **AND** the `evidence` field quotes the actual title text from the listing
- **AND** the `visibility` is `"observable"`

#### Scenario: Keyword field is flagged as not visible
- **WHEN** the audit runs on any public App Store listing
- **THEN** the Keyword field dimension has `score: null` and `visibility: "not-visible-from-public-listing"`
- **AND** the dimension result still appears in the report with `reasoning` explaining what is and is not knowable from the public listing

### Requirement: Compute the overall score deterministically with renormalization

The system SHALL compute the overall ASO score out of 100 in TypeScript, not by asking the LLM.

For observable dimensions, the score contribution is `(score / 10) * weight`. The sum across observable dimensions is divided by the sum of observable weights, then multiplied by 100, producing a renormalized score so missing-data dimensions do not artificially depress the result.

The report MUST include both the renormalized `overallScore` and the list of observable / non-observable dimensions, so the renormalization is auditable.

#### Scenario: All dimensions observable
- **WHEN** every dimension has a numeric score (hypothetical)
- **THEN** `overallScore` equals the standard weighted sum out of 100

#### Scenario: Keyword field not observable
- **WHEN** the Keyword field dimension has `score: null` (its weight is 15)
- **AND** all other dimensions have numeric scores
- **THEN** `overallScore` is computed against the remaining 85 weight units and rescaled to 100
- **AND** the report lists Keyword field under non-observable dimensions

#### Scenario: LLM-supplied overall score is ignored
- **WHEN** the LLM output includes a top-level `overallScore` field
- **THEN** the system overwrites it with the deterministically-computed value before persisting the report

### Requirement: Produce prioritized recommendations with before/after examples

The system SHALL emit three ordered recommendation lists in every report: `quickWins` (3-5 items, implementable today, high impact), `highImpact` (3-5 items, more effort), and `strategic` (3-5 items, longer-term).

Each recommendation MUST include: `title`, `evidence` (the specific data point from the listing that motivates it), `rationale` (one-to-three sentences), and — for any text-based change to title, subtitle, description, or screenshot captions — both `before` (the current text from the listing) and `after` (the proposed text).

Recommendations that target non-observable dimensions (e.g., the keyword field) MUST be framed as methodology guidance rather than concrete before/after edits.

#### Scenario: Title rewrite recommendation includes before and after
- **WHEN** the audit recommends rewriting the title
- **THEN** the recommendation includes `before` containing the actual current title from the listing
- **AND** `after` containing a concrete proposed title within Apple's 30-character limit
- **AND** `rationale` referencing the specific ASO principle being applied

#### Scenario: Keyword field recommendation is methodology, not a literal edit
- **WHEN** the audit recommends improvements relating to the keyword field
- **THEN** the recommendation describes a keyword research approach rather than a `before` / `after` text edit
- **AND** the recommendation explicitly notes that the keyword field is set in App Store Connect

### Requirement: Compare against top three competitors

The system SHALL include a `competitorComparison` section in the report comparing the subject app against up to three same-category competitors fetched at audit time.

The comparison MUST cover, at minimum: title and subtitle (text), average rating and rating count when available, screenshot count, presence of preview video, and a one-sentence summary of where the subject is weaker or stronger.

If competitor data is unavailable, the section MUST be present and explicitly state competitor data was unavailable, rather than being omitted.

#### Scenario: Three competitors compared
- **WHEN** the competitor tool returns three competitors
- **THEN** `competitorComparison.competitors` has length three
- **AND** the table includes title, subtitle, average rating, rating count, screenshot count, and preview video presence for each, plus the subject app
- **AND** a `summary` field describes the subject's relative position in one to three sentences

#### Scenario: No competitor data available
- **WHEN** the competitor tool returns an empty array
- **THEN** `competitorComparison.competitors` is empty
- **AND** `competitorComparison.summary` explicitly states competitor data was unavailable

### Requirement: Audit report is validated against a typed schema

The system SHALL define an `AuditReport` Zod schema. The LLM output SHALL be parsed and validated against this schema before being returned to the UI.

On parse failure, the system SHALL retry once with the validation error included as additional context. A second parse failure SHALL result in a typed error surfaced to the user, never a partial or fabricated report.

#### Scenario: Valid output passes through
- **WHEN** the LLM returns output that matches the `AuditReport` schema
- **THEN** the report is returned to the caller

#### Scenario: Invalid output triggers one retry
- **WHEN** the first LLM output fails Zod validation
- **THEN** the system retries the generation once, with the validation error included as context
- **AND** if the retry succeeds, the report is returned

#### Scenario: Two failures yield a typed error
- **WHEN** two consecutive LLM outputs fail validation
- **THEN** the system returns a typed error to the caller indicating audit generation failed
- **AND** the error message is shown to the user without fabricating any audit content
