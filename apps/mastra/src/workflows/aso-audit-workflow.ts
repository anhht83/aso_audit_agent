/**
 * ASO audit workflow.
 *
 * Two steps with a human-in-the-loop suspend between them:
 *
 *   1. resolveListing(url)  ->  { listing, confirmed }
 *       Calls fetchListing(). On success, suspends with the AppListing in
 *       suspendData so the UI can render a confirmation card. The resume
 *       payload is `{ confirmed: boolean }`. After resume, forwards the
 *       listing from suspendData to the next step alongside `confirmed`.
 *
 *   2. runAudit             ->  AuditReport | { cancelled: true }
 *       Branches on `confirmed`. If true: fetches competitors, then runs the
 *       scoring driver, returns the AuditReport. If false: returns
 *       { kind: 'cancelled' }.
 *
 * Each step pushes `progress` events through the `writer` so the UI can render
 * the progress strip. The chat route unwraps these from
 * `workflow-step-output` chunks.
 *
 * Verified against @mastra/core@1.36.0:
 *   - createStep execute receives { inputData, resumeData, suspend,
 *     suspendData, writer, ... }
 *   - suspend(payload) returns InnerOutput (a branded void); the only correct
 *     way to suspend is `return await suspend(payload)`.
 *   - On resume the same execute() runs again with resumeData populated and
 *     suspendData carrying the original suspend() argument.
 */
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { appListingSchema, auditReportSchema } from '@aso/shared'
import { z } from 'zod'
import { fetchCompetitorList } from '../scrape/fetch-competitor-list'
import { fetchListing } from '../scrape/fetch-listing'
import { runAudit } from '../audit/score'

// ---------------------------------------------------------------------------
// Step 1: resolveListing
// ---------------------------------------------------------------------------

const resolveListing = createStep({
  id: 'resolveListing',
  inputSchema: z.object({
    url: z.string().describe('Apple App Store URL pasted by the user.'),
  }),
  suspendSchema: z.object({
    listing: appListingSchema,
  }),
  resumeSchema: z.object({
    confirmed: z.boolean(),
  }),
  outputSchema: z.object({
    listing: appListingSchema,
    confirmed: z.boolean(),
  }),
  execute: async ({ inputData, resumeData, suspend, suspendData, writer }) => {
    // ----- First execution path: scrape, then suspend -----
    if (resumeData === undefined) {
      await writer?.write({ type: 'progress', step: 'resolveListing', status: 'started' })

      const result = await fetchListing(inputData.url)
      if (!result.ok) {
        await writer?.write({
          type: 'progress',
          step: 'resolveListing',
          status: 'failed',
          message: result.error.message,
        })
        // Throw so the workflow run.status becomes 'failed' with this error.
        throw new Error(result.error.message)
      }

      await writer?.write({
        type: 'progress',
        step: 'resolveListing',
        status: 'completed',
      })

      return await suspend({ listing: result.listing })
    }

    // ----- Resume path: forward the listing from suspendData -----
    if (!suspendData) {
      throw new Error(
        'resolveListing was resumed but suspendData is missing. This should be impossible.',
      )
    }
    return {
      listing: suspendData.listing,
      confirmed: resumeData.confirmed,
    }
  },
})

// ---------------------------------------------------------------------------
// Step 2: runAuditStep
// ---------------------------------------------------------------------------

const runAuditStep = createStep({
  id: 'runAudit',
  inputSchema: z.object({
    listing: appListingSchema,
    confirmed: z.boolean(),
  }),
  outputSchema: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('report'), report: auditReportSchema }),
    z.object({ kind: z.literal('cancelled') }),
  ]),
  execute: async ({ inputData, writer }) => {
    const { listing, confirmed } = inputData

    if (!confirmed) {
      return { kind: 'cancelled' as const }
    }

    // --- fetchCompetitors ---
    await writer?.write({ type: 'progress', step: 'fetchCompetitors', status: 'started' })
    const competitorResult = await fetchCompetitorList({
      category: listing.category,
      country: listing.country,
      excludeAppId: listing.appId,
      limit: 3,
    })
    await writer?.write({ type: 'progress', step: 'fetchCompetitors', status: 'completed' })

    // --- scoring ---
    await writer?.write({ type: 'progress', step: 'scoring', status: 'started' })
    let report
    try {
      report = await runAudit({
        listing,
        competitors: competitorResult.competitors,
        competitorWarning: competitorResult.warning,
      })
    } catch (e) {
      await writer?.write({
        type: 'progress',
        step: 'scoring',
        status: 'failed',
        message: (e as Error).message,
      })
      throw e
    }
    await writer?.write({ type: 'progress', step: 'scoring', status: 'completed' })

    return { kind: 'report' as const, report }
  },
})

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const asoAuditWorkflow = createWorkflow({
  id: 'aso-audit-workflow',
  inputSchema: z.object({
    url: z.string(),
  }),
  outputSchema: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('report'), report: auditReportSchema }),
    z.object({ kind: z.literal('cancelled') }),
  ]),
})
  .then(resolveListing)
  .then(runAuditStep)
  .commit()
