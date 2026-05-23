## ADDED Requirements

### Requirement: Next.js chat front-end

The system SHALL provide a Next.js App Router front-end that renders a single-page chat UI consuming the Mastra service over HTTP plus a streaming channel.

The UI MUST display a message list with user and assistant turns, an input box, a send action, and a loading state while a response is in flight.

#### Scenario: User sends a URL and sees streamed reply
- **WHEN** the user pastes an App Store URL and submits
- **THEN** the user message appears in the list immediately
- **AND** an assistant message bubble appears and updates as content streams in

### Requirement: Confirmation card for the resolved listing

The UI SHALL render a confirmation card when the workflow suspends with an `AppListing`. The card MUST display the app icon, name, developer, primary category, and country, with explicit "Yes, audit this" and "No, that's wrong" actions.

Clicking an action SHALL send the corresponding confirmation message to the agent without requiring the user to type "yes" or "no" manually. Typed "yes"/"no" replies MUST still work in case the user prefers text.

#### Scenario: Confirmation card appears after metadata fetch
- **WHEN** the `resolveListing` step completes
- **THEN** the UI renders a card showing the app icon, name, developer, category, and country
- **AND** "Yes, audit this" and "No, wrong app" buttons are visible

#### Scenario: Clicking yes sends confirmation
- **WHEN** the user clicks "Yes, audit this"
- **THEN** a confirmation is sent to the agent and the audit phase begins

### Requirement: Progress strip during audit run

The UI SHALL render a progress indicator that updates from `progress` events while the audit is running. At minimum it MUST show, in order: "Fetching app metadata", "Scraping competitors", "Scoring dimensions", each transitioning from in-progress to complete as the corresponding `progress` event arrives.

The progress indicator MUST appear while the audit is running and disappear or collapse once the `audit-report` message arrives.

#### Scenario: Step status updates as events arrive
- **WHEN** the `fetchCompetitors` `started` event arrives
- **THEN** the corresponding step shows an in-progress state
- **WHEN** the `fetchCompetitors` `completed` event arrives
- **THEN** the corresponding step shows a completed state

### Requirement: Render the structured audit report

The UI SHALL render the `AuditReport` message with a dedicated report component, not as raw text.

The report MUST include:
- An overall score (out of 100) prominently displayed.
- A per-dimension score card with a progress bar for each observable dimension and a clearly labeled "Not visible from public listing" treatment for non-observable dimensions.
- Three recommendation sections — Quick Wins, High-Impact Changes, Strategic — each listing the recommendations with their evidence, rationale, and before/after text where present.
- A competitor comparison table with the subject app and up to three competitors, or a clearly labeled "Competitor data unavailable" message when empty.

#### Scenario: Score card renders bars for observable dimensions
- **WHEN** the report arrives with Title scored 7/10 weight 20%
- **THEN** the Title row in the score card shows the dimension name, "7 / 10", a 70%-filled bar, and the weight

#### Scenario: Non-observable dimension renders without a score
- **WHEN** the Keyword field dimension has `score: null` and `visibility: "not-visible-from-public-listing"`
- **THEN** the Keyword field row displays "Not visible from public listing" instead of a bar
- **AND** the reasoning text is shown

#### Scenario: Before/after diff renders for text recommendations
- **WHEN** a recommendation includes `before` and `after`
- **THEN** the UI displays both, visually distinguished, in the same recommendation card

#### Scenario: Competitor comparison renders as a table
- **WHEN** the report includes one or more competitors
- **THEN** a table shows the subject app and each competitor on the comparison columns
- **WHEN** the report's competitor list is empty
- **THEN** the section renders a "Competitor data unavailable" message instead of an empty table

### Requirement: Error states are user-readable

The UI SHALL surface errors from the Mastra service as inline assistant messages containing the typed error's user-facing message. The UI MUST NOT silently retry, swallow, or replace error content with empty state.

#### Scenario: Scraper error is shown
- **WHEN** the Mastra service returns a scraping error
- **THEN** the UI renders an assistant message with the error's user-facing text
- **AND** the input remains usable so the user can try a different URL

### Requirement: One command starts the full stack

The system SHALL expose a root `npm run dev` script that starts both the Mastra service and the Next.js app concurrently. `npm install` at the repo root SHALL install all workspace dependencies.

#### Scenario: Fresh clone boots
- **WHEN** a reviewer runs `npm install && npm run dev` at the repo root after copying `.env.example` to `.env` and filling in keys
- **THEN** both services start and the chat UI is reachable in a browser
- **AND** no additional commands are required to use the app
