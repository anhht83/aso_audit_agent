/**
 * POST /chat - the only HTTP surface the Next.js UI consumes.
 *
 * Request body (validated against ChatRequest from @aso/shared):
 *   { kind: 'start', text: string }
 *     -> Starts a new workflow run with the URL extracted from text.
 *
 *   { kind: 'resume', resumeToken: string, confirmed: boolean }
 *     -> Resumes a suspended workflow.
 *
 * Response: application/x-ndjson stream. One StreamEvent JSON object per line.
 *
 * State: workflow runs are tracked by Mastra's storage; the resumeToken IS the
 * workflow run ID, which the client echoes back on resume.
 *
 * Verified against @mastra/core@1.36.0:
 *   - run.stream() returns WorkflowRunOutput (synchronous, NOT a promise).
 *   - WorkflowRunOutput has `.fullStream: ReadableStream<WorkflowStreamEvent>`,
 *     `[Symbol.asyncIterator]`, and `.result: Promise<WorkflowResult>`.
 *   - WorkflowStreamEvent has a `type` discriminator; our writer-emitted
 *     progress events arrive wrapped in `workflow-step-output` chunks at
 *     `payload.output`.
 *   - On suspend the awaited `.result` has shape
 *     { status: 'suspended', suspendPayload, suspended, ... }.
 *   - run.resumeStream({ resumeData }) returns the same WorkflowRunOutput shape.
 */
import { registerApiRoute } from '@mastra/core/server'
import {
  appListingSchema,
  auditReportSchema,
  chatRequestSchema,
  streamEventSchema,
  type StreamEvent,
} from '@aso/shared'
import { createEventStream, STREAM_HEADERS } from './event-stream'

/**
 * Extract an Apple App Store URL from arbitrary user text.
 *
 * We accept any token containing "apps.apple.com". parseAppStoreUrl() inside
 * the workflow does the strict validation and emits a user-friendly error.
 */
function extractAppStoreUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S*apps\.apple\.com\S*/i)
  return match ? match[0] : null
}

/**
 * Mastra workflow streams emit WorkflowStreamEvent chunks (workflow-start,
 * workflow-step-output, etc.). Our step writer payloads ride inside
 * workflow-step-output chunks at payload.output. This unwraps them back into
 * the StreamEvent shape the UI expects.
 *
 * Returns null for chunks that don't carry one of our event payloads.
 */
function unwrapStepOutput(chunk: unknown): StreamEvent | null {
  if (!chunk || typeof chunk !== 'object') return null
  const c = chunk as { type?: unknown; payload?: unknown }
  if (c.type !== 'workflow-step-output') return null
  if (!c.payload || typeof c.payload !== 'object') return null
  const p = c.payload as { output?: unknown }
  const parsed = streamEventSchema.safeParse(p.output)
  return parsed.success ? parsed.data : null
}

export const chatRoute = registerApiRoute('/chat', {
  method: 'POST',
  handler: async c => {
    const mastra = c.get('mastra')
    const logger = mastra.getLogger()

    // Parse + validate request body.
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body.' }, 400)
    }
    const parsed = chatRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body.' }, 400)
    }
    const request = parsed.data

    const workflow = mastra.getWorkflow('asoAuditWorkflow')
    if (!workflow) {
      return c.json({ error: 'Audit workflow is not registered.' }, 500)
    }

    const { stream, writer } = createEventStream()

    /**
     * Forward each workflow-step-output chunk's payload to our event writer,
     * if its payload validates as a StreamEvent. Other chunk types (start,
     * finish, step-start, etc.) are dropped.
     */
    const forwardChunks = async (chunks: AsyncIterable<unknown>) => {
      for await (const chunk of chunks) {
        const event = unwrapStepOutput(chunk)
        if (event) await writer.write(event)
      }
    }

    const task = (async () => {
      try {
        if (request.kind === 'start') {
          const url = extractAppStoreUrl(request.text)
          if (!url) {
            await writer.write({
              type: 'message',
              kind: 'error',
              text: "I couldn't find an Apple App Store URL in your message. Paste a URL like https://apps.apple.com/us/app/<slug>/id<digits> and I'll audit it.",
              code: 'no_url',
            })
            return
          }

          const run = await workflow.createRun()
          // run.stream returns WorkflowRunOutput directly (not a promise).
          const output = run.stream({ inputData: { url } })
          await forwardChunks(output.fullStream)
          const result = await output.result

          await emitFinalForResult(result, run.runId, writer)
          return
        }

        // request.kind === 'resume'
        const run = await workflow.createRun({ runId: request.resumeToken })
        const output = run.resumeStream({ resumeData: { confirmed: request.confirmed } })
        await forwardChunks(output.fullStream)
        const result = await output.result

        await emitFinalForResult(result, run.runId, writer)
      } catch (e) {
        logger?.error('Chat route handler threw', { error: e })
        await writer.write({
          type: 'message',
          kind: 'error',
          text: e instanceof Error ? e.message : 'Unexpected server error.',
        })
      } finally {
        await writer.close()
      }
    })()

    void task

    return new Response(stream, { headers: STREAM_HEADERS })
  },
})

/**
 * Translate a WorkflowResult into the final message(s) the UI needs.
 * Returns nothing - writes directly to the SSE writer.
 */
async function emitFinalForResult(
  result: unknown,
  runId: string,
  writer: { write(event: StreamEvent): Promise<void> },
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
