/**
 * Translate a terminal Mastra `WorkflowResult` into the final chat-dialect
 * `StreamEvent` (always `{ type: 'message', kind: ... }`) and write it through
 * the supplied stream writer.
 *
 * Purely domain translation - no HTTP awareness. The chat handler calls this
 * after awaiting `output.result` to decide whether to emit a confirmation
 * card (suspended), an audit report (success + report), a cancel ack
 * (success + cancelled), or an error message (failed / unexpected shape).
 *
 * Verified against @mastra/core@1.36.0:
 *   - On suspend, the result has shape
 *     { status: 'suspended', suspendPayload: { <stepId>: <suspendData> } }.
 *     We pick the listing from the known `resolveListing` step.
 *   - On success, the final step's output is at `result.result`.
 *   - On failure, the error is at `result.error` (Error instance or string).
 */
import { appListingSchema, auditReportSchema, type StreamEvent } from '@aso/shared'

export interface StreamEventSink {
  write(event: StreamEvent): Promise<void>
}

export async function emitFinalChatEvent(
  result: unknown,
  runId: string,
  writer: StreamEventSink,
): Promise<void> {
  if (!result || typeof result !== 'object') {
    await writer.write({
      type: 'message',
      kind: 'error',
      text: 'The audit workflow returned an unexpected result shape.',
    })
    return
  }
  const r = result as {
    status?: string
    result?: unknown
    suspendPayload?: unknown
    error?: unknown
  }

  if (r.status === 'suspended') {
    // @mastra/core@1.36.0 keys suspendPayload by stepId, i.e.
    //   { resolveListing: { listing: AppListing } }
    // not flat `{ listing: AppListing }` (which was the older shape). We
    // pick the listing from the known resolveListing step and validate at
    // the boundary - the step's suspendSchema should have already
    // validated, but trust nothing crossing the workflow engine boundary.
    const sp = r.suspendPayload as
      | Record<string, { listing?: unknown } | undefined>
      | undefined
    const listingCandidate = sp?.resolveListing?.listing ?? (sp as { listing?: unknown })?.listing
    const listingParse = appListingSchema.safeParse(listingCandidate)
    if (!listingParse.success) {
      await writer.write({
        type: 'message',
        kind: 'error',
        text: 'The audit workflow suspended without a valid listing payload. This is a bug.',
        code: 'no_suspend_data',
      })
      return
    }
    await writer.write({
      type: 'message',
      kind: 'confirmation',
      listing: listingParse.data,
      resumeToken: runId,
    })
    return
  }

  if (r.status === 'success') {
    const out = r.result as { kind?: string; report?: unknown } | undefined
    if (out?.kind === 'report') {
      const reportParse = auditReportSchema.safeParse(out.report)
      if (!reportParse.success) {
        await writer.write({
          type: 'message',
          kind: 'error',
          text: 'The audit completed but the final report failed schema validation.',
        })
        return
      }
      await writer.write({
        type: 'message',
        kind: 'audit-report',
        report: reportParse.data,
      })
      return
    }
    if (out?.kind === 'cancelled') {
      await writer.write({
        type: 'message',
        kind: 'text',
        role: 'assistant',
        text: "Got it - paste a different App Store URL whenever you're ready.",
      })
      return
    }
    await writer.write({
      type: 'message',
      kind: 'error',
      text: 'The audit workflow completed with an unexpected result.',
    })
    return
  }

  if (r.status === 'failed') {
    const message =
      r.error instanceof Error
        ? r.error.message
        : typeof r.error === 'string'
          ? r.error
          : 'The audit workflow failed.'
    await writer.write({ type: 'message', kind: 'error', text: message })
    return
  }

  await writer.write({
    type: 'message',
    kind: 'error',
    text: `The audit workflow ended in an unexpected state: ${String(r.status)}.`,
  })
}
