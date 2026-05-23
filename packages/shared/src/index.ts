/**
 * @aso/shared
 *
 * Network contract between the Mastra service (apps/mastra) and the Next.js
 * front-end (apps/web). Every type that crosses the wire lives here, defined
 * with Zod so both sides validate at the boundary.
 *
 * Keep this file free of runtime side effects: it must be safe to import from
 * a browser bundle.
 */
import { z } from 'zod'

// ============================================================================
// App Store listing - the structured output of fetchAppMetadata
// ============================================================================

/**
 * The ten ASO audit dimensions, in the order they appear in the report.
 * Order matches the brief's rubric table.
 */
export const DIMENSION_NAMES = [
  'Title',
  'Subtitle',
  'Keyword field',
  'Description',
  'Screenshots',
  'App preview video',
  'Ratings & reviews',
  'Icon',
  'Conversion signals',
  'Competitive position',
] as const

export type DimensionName = (typeof DIMENSION_NAMES)[number]

/**
 * Default weights per dimension, summing to 100. Source of truth for the
 * `compute-overall-score` logic and the skill's rubric table. Renormalization
 * for non-observable dimensions is computed at audit time, not baked in here.
 */
export const DIMENSION_WEIGHTS: Record<DimensionName, number> = {
  Title: 20,
  Subtitle: 15,
  'Keyword field': 15,
  Description: 10,
  Screenshots: 15,
  'App preview video': 5,
  'Ratings & reviews': 15,
  Icon: 5,
  'Conversion signals': 5,
  'Competitive position': 5,
}

export const appListingSchema = z.object({
  appId: z.string().min(1),
  country: z.string().length(2),
  url: z.string().url(),
  name: z.string().min(1),
  developer: z.string().min(1),
  /** Primary category as shown on the listing page. */
  category: z.string().min(1),
  iconUrl: z.string().url(),
  /** Screenshot image URLs in display order. May be empty if scrape fails partially. */
  screenshotUrls: z.array(z.string().url()),
  /** App preview video URL if present on the listing, else null. */
  previewVideoUrl: z.string().url().nullable(),
  /** Full long description from the listing. */
  description: z.string(),
  /** iOS-only subtitle. Null if the listing has none. */
  subtitle: z.string().nullable(),
  /** Current version string (e.g. "8.9.2"). Null if not visible. */
  currentVersion: z.string().nullable(),
  /** What's New text from the latest update. Null if not visible. */
  whatsNew: z.string().nullable(),
  /** Average rating 1-5 if the listing shows one. */
  averageRating: z.number().min(0).max(5).nullable(),
  /** Total rating count if the listing shows one. */
  ratingCount: z.number().int().min(0).nullable(),
  /** Promotional text when surfaced on the listing. Null if not visible. */
  promotionalText: z.string().nullable(),
})

export type AppListing = z.infer<typeof appListingSchema>

// ============================================================================
// Audit report
// ============================================================================

export const visibilitySchema = z.enum([
  'observable',
  'not-visible-from-public-listing',
])
export type Visibility = z.infer<typeof visibilitySchema>

export const dimensionSchema = z.object({
  name: z.enum(DIMENSION_NAMES),
  /** Weight 0-100, matches DIMENSION_WEIGHTS by name. */
  weight: z.number().min(0).max(100),
  /** 0-10 numeric score. Null when visibility is "not-visible-from-public-listing". */
  score: z.number().min(0).max(10).nullable(),
  /** Concrete data point cited from the listing. Required even for non-observable dimensions to explain reasoning. */
  evidence: z.string().min(1),
  /** 1-3 sentence rationale. */
  reasoning: z.string().min(1),
  visibility: visibilitySchema,
})

export type Dimension = z.infer<typeof dimensionSchema>

export const recommendationSchema = z.object({
  /** Short, action-oriented title (e.g. "Rewrite the title to lead with 'meditation'"). */
  title: z.string().min(1),
  /** Specific data point from the listing that motivates this recommendation. */
  evidence: z.string().min(1),
  /** 1-3 sentence rationale. */
  rationale: z.string().min(1),
  /** Current text from the listing, for text-based changes. */
  before: z.string().nullable(),
  /** Proposed replacement text, for text-based changes. */
  after: z.string().nullable(),
})

export type Recommendation = z.infer<typeof recommendationSchema>

export const competitorSummarySchema = z.object({
  appId: z.string().min(1),
  name: z.string().min(1),
  developer: z.string().min(1),
  title: z.string(),
  subtitle: z.string().nullable(),
  averageRating: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().min(0).nullable(),
  screenshotCount: z.number().int().min(0),
  hasPreviewVideo: z.boolean(),
})

export type CompetitorSummary = z.infer<typeof competitorSummarySchema>

export const competitorComparisonSchema = z.object({
  subject: competitorSummarySchema,
  competitors: z.array(competitorSummarySchema),
  /** One- to three-sentence summary of relative position. */
  summary: z.string().min(1),
})

export type CompetitorComparison = z.infer<typeof competitorComparisonSchema>

/**
 * The complete audit report. `overallScore` is computed deterministically by
 * the service after the LLM returns dimensions, so the schema permits it to be
 * present (when emitted by the service) but the LLM-shaped schema below omits it.
 */
export const auditReportSchema = z.object({
  app: appListingSchema,
  overallScore: z.number().min(0).max(100),
  dimensions: z.array(dimensionSchema),
  quickWins: z.array(recommendationSchema),
  highImpact: z.array(recommendationSchema),
  strategic: z.array(recommendationSchema),
  competitorComparison: competitorComparisonSchema,
})

export type AuditReport = z.infer<typeof auditReportSchema>

/**
 * What we ask the LLM to produce. We compute `overallScore` ourselves, and
 * the LLM doesn't need to know about the resolved `app` listing (the service
 * attaches it after generation).
 */
export const llmAuditOutputSchema = auditReportSchema.omit({
  app: true,
  overallScore: true,
})

export type LlmAuditOutput = z.infer<typeof llmAuditOutputSchema>

// ============================================================================
// Streaming contract: progress + chat messages
// ============================================================================

export const progressStepSchema = z.enum([
  'resolveListing',
  'fetchCompetitors',
  'scoring',
])
export type ProgressStep = z.infer<typeof progressStepSchema>

export const progressStatusSchema = z.enum(['started', 'completed', 'failed'])
export type ProgressStatus = z.infer<typeof progressStatusSchema>

export const progressEventSchema = z.object({
  type: z.literal('progress'),
  step: progressStepSchema,
  status: progressStatusSchema,
  /**
   * Optional human-readable detail (typically used to attach a failure message
   * when status === 'failed'). We deliberately do NOT have a free-form `data`
   * field here: Mastra's internal JSON-Schema conversion (Zod 4) cannot
   * represent `z.unknown().optional()`, and the UI doesn't render structured
   * payloads from progress events anyway - it gets the listing via the
   * `confirmation` message and the audit via the `audit-report` message.
   */
  message: z.string().optional(),
})

export type ProgressEvent = z.infer<typeof progressEventSchema>

/**
 * Confirmation card payload sent by the agent when the workflow suspends after
 * resolveListing. The UI renders this as a clickable card.
 */
export const confirmationMessageSchema = z.object({
  type: z.literal('message'),
  kind: z.literal('confirmation'),
  listing: appListingSchema,
  /** Token used to resume the suspended workflow. Opaque to the UI. */
  resumeToken: z.string().min(1),
})

export type ConfirmationMessage = z.infer<typeof confirmationMessageSchema>

/** Plain text/markdown message from the assistant or user. */
export const textMessageSchema = z.object({
  type: z.literal('message'),
  kind: z.literal('text'),
  role: z.enum(['assistant', 'user']),
  text: z.string(),
})

export type TextMessage = z.infer<typeof textMessageSchema>

export const auditReportMessageSchema = z.object({
  type: z.literal('message'),
  kind: z.literal('audit-report'),
  report: auditReportSchema,
})

export type AuditReportMessage = z.infer<typeof auditReportMessageSchema>

export const errorMessageSchema = z.object({
  type: z.literal('message'),
  kind: z.literal('error'),
  /** User-facing error text. Safe to render verbatim. */
  text: z.string().min(1),
  /** Optional category for client-side handling. */
  code: z.string().optional(),
})

export type ErrorMessage = z.infer<typeof errorMessageSchema>

export const chatMessageSchema = z.discriminatedUnion('kind', [
  confirmationMessageSchema,
  textMessageSchema,
  auditReportMessageSchema,
  errorMessageSchema,
])

export type ChatMessage = z.infer<typeof chatMessageSchema>

/**
 * Any event that may appear over the streaming channel. The client decodes
 * the JSON envelope, then dispatches based on `type` and (for messages) `kind`.
 *
 * Note: this is a plain `z.union`, NOT a `z.discriminatedUnion('type', ...)`.
 * All four message variants share `type: 'message'` and only differ on `kind`,
 * so a single-key `type` discriminator collapses them onto one bucket and
 * Zod 4 rejects it with "Duplicate discriminator value 'message'". The
 * structure is still effectively a two-level tagged union (`type`, then
 * `kind`), and `chatMessageSchema` below already discriminates on `kind` for
 * the message branch.
 */
export const streamEventSchema = z.union([progressEventSchema, chatMessageSchema])

export type StreamEvent = z.infer<typeof streamEventSchema>

// ============================================================================
// Client -> server request payloads
// ============================================================================

/**
 * The Next.js app sends one of these to the chat endpoint on each turn.
 *
 * - `start`: a new audit run, carrying the user's free-form text (typically
 *   contains an App Store URL).
 * - `resume`: response to a suspended workflow's confirmation prompt.
 */
export const chatRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('start'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('resume'),
    resumeToken: z.string().min(1),
    confirmed: z.boolean(),
  }),
])

export type ChatRequest = z.infer<typeof chatRequestSchema>
