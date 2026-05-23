## ADDED Requirements

### Requirement: Two-phase conversation flow

The system SHALL implement the audit interaction as a two-phase conversation orchestrated by a Mastra workflow with human-in-the-loop suspension.

Phase one (`resolveListing`): given a user message containing an App Store URL, the workflow validates the URL, scrapes the listing, and suspends with the resolved `AppListing` as suspend data so the user can confirm.

Phase two (`runAudit`): on resume with `{ confirmed: true }`, the workflow fetches competitors and runs the audit, returning an `AuditReport`. On resume with `{ confirmed: false }`, the workflow ends and the agent prompts the user for a different URL.

#### Scenario: Happy path
- **WHEN** the user pastes a valid Apple App Store URL
- **AND** the workflow scrapes the listing and suspends
- **AND** the agent presents the listing card and the user replies "yes"
- **THEN** the workflow resumes with `{ confirmed: true }`
- **AND** the workflow runs the audit and returns an `AuditReport`

#### Scenario: User rejects the resolved listing
- **WHEN** the workflow suspends with an `AppListing` and the user replies "no" or "that's the wrong app"
- **THEN** the workflow resumes with `{ confirmed: false }` and terminates
- **AND** the agent asks the user to paste a different URL

#### Scenario: Invalid URL never enters the workflow
- **WHEN** the user pastes a non-Apple URL or a malformed Apple URL
- **THEN** the agent responds with the validation error and the workflow is not started

### Requirement: Orchestrator agent owns the conversation

The system SHALL implement an `asoAuditAgent` Mastra agent that owns the chat conversation, decides when to start the workflow, interprets the user's confirmation reply, and resumes the workflow.

The agent's system prompt MUST be short and operational (extract URL, run workflow, present confirmation, interpret yes/no, present report). The audit rubric itself MUST NOT live in the system prompt — it lives in the `aso-audit` skill.

#### Scenario: Agent extracts URL from natural language
- **WHEN** the user says "audit this please: https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580"
- **THEN** the agent extracts the URL and starts the workflow with it

#### Scenario: Agent interprets affirmative replies
- **WHEN** the workflow is suspended and the user replies "yes", "yep", "that's right", or similar
- **THEN** the agent resumes the workflow with `{ confirmed: true }`

#### Scenario: Agent interprets negative replies
- **WHEN** the workflow is suspended and the user replies "no", "wrong app", or similar
- **THEN** the agent resumes the workflow with `{ confirmed: false }`

### Requirement: Stream progress and content to the UI

The system SHALL stream two event types from the Mastra service to the front-end over the chat channel:

- `progress`: workflow step lifecycle events, shape `{ step: "resolveListing" | "fetchCompetitors" | "scoring", status: "started" | "completed", data?: unknown }`.
- `message`: agent text content. The final audit MUST be delivered as a single `message` with `kind: "audit-report"` and a payload conforming to the `AuditReport` schema.

The UI MUST receive `progress` events for at least the three named steps in the order they execute. Token-level streaming for agent text is permitted but not required for the structured audit payload, which is a single message.

#### Scenario: Progress events fire in order
- **WHEN** an audit is running end-to-end
- **THEN** the UI receives `progress` events for `resolveListing`, `fetchCompetitors`, and `scoring`, each with `status: "started"` followed by `status: "completed"`, in that order

#### Scenario: Audit report arrives as a structured message
- **WHEN** the audit completes
- **THEN** the UI receives a `message` event with `kind: "audit-report"` and a payload that validates against the `AuditReport` schema

### Requirement: Single-session, in-memory state

The system SHALL maintain conversation and workflow state in memory for the duration of a single server process. Conversation persistence, multi-user identity, and cross-session resume are out of scope.

#### Scenario: Restart clears state
- **WHEN** the Mastra service is restarted
- **THEN** any in-progress workflow is lost and the user must start a new audit
