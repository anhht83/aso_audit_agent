/**
 * POST /chat handler.
 *
 * The only HTTP entry point the Next.js UI talks to. Accepts:
 *   { kind: 'start', text: string }
 *     -> Extract the App Store URL from the text and start a new workflow run.
 *
 *   { kind: 'resume', resumeToken: string, confirmed: boolean }
 *     -> Resume the suspended workflow identified by resumeToken.
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
import type { registerApiRoute } from '@mastra/core/server'
import { chatRequestSchema } from '@aso/shared'
import { emitFinalChatEvent } from '../libs/emit-chat-event'
import { createEventStream, forwardWorkflowChunks, STREAM_HEADERS } from '../libs/event-stream'
import { extractAppStoreUrl } from '../libs/extract-url'

/**
 * Derive the Hono-flavoured handler type from `registerApiRoute`'s parameter
 * shape so we don't have to reach into the `hono` package (which is only a
 * transitive dependency of `@mastra/core`).
 */
type ChatHandler = NonNullable<
  Parameters<typeof registerApiRoute<'/chat'>>[1]['handler']
>

export const chatHandler: ChatHandler = async c => {
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
        await forwardWorkflowChunks(output.fullStream, writer)
        const result = await output.result

        // runId is aka the resumeToken
        await emitFinalChatEvent(result, run.runId, writer)
        return
      }

      // request.kind === 'resume'
      const run = await workflow.createRun({ runId: request.resumeToken })
      const output = run.resumeStream({ resumeData: { confirmed: request.confirmed } })
      await forwardWorkflowChunks(output.fullStream, writer)
      const result = await output.result

      await emitFinalChatEvent(result, run.runId, writer)
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
}

