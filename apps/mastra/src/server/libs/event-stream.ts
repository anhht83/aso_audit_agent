/**
 * Streaming helpers for the chat route.
 *
 * Wire format: newline-delimited JSON over a Web Stream. One StreamEvent per
 * line. No SSE framing, no event types, no retry tokens - just one
 * `JSON.stringify(event) + '\n'` per write.
 *
 * Why not SSE: SSE's features (event IDs, named events, automatic reconnect)
 * are useless for our flow. We just need to stream typed JSON objects.
 * NDJSON over a ReadableStream is the same conceptual wire format with less
 * framing code and works directly with WHATWG Streams primitives on both
 * sides.
 */
import { streamEventSchema, type StreamEvent } from '@aso/shared'

const encoder = new TextEncoder()

export interface EventWriter {
  write(event: StreamEvent): Promise<void>
  close(): Promise<void>
}

export function createEventStream(): {
  stream: ReadableStream<Uint8Array>
  writer: EventWriter
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })

  let closed = false
  const writer: EventWriter = {
    async write(event) {
      if (closed) return
      try {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      } catch {
        // The client disconnected. Mark closed and stop trying to write.
        closed = true
      }
    },
    async close() {
      if (closed) return
      closed = true
      try {
        controller.close()
      } catch {
        // Already closed.
      }
    },
  }

  return { stream, writer }
}

/**
 * Mastra workflow streams emit `WorkflowStreamEvent` chunks (`workflow-start`,
 * `workflow-step-output`, `workflow-finish`, ...). Our step-writer payloads
 * ride inside `workflow-step-output` chunks at `payload.output`. This unwraps
 * one chunk back into the `StreamEvent` shape the chat UI expects.
 *
 * Returns `null` for chunks that don't carry one of our event payloads (e.g.
 * lifecycle chunks like `workflow-start`), so callers can filter them out.
 */
export function unwrapStepOutput(chunk: unknown): StreamEvent | null {
  if (!chunk || typeof chunk !== 'object') return null
  const c = chunk as { type?: unknown; payload?: unknown }
  if (c.type !== 'workflow-step-output') return null
  if (!c.payload || typeof c.payload !== 'object') return null
  const p = c.payload as { output?: unknown }
  const parsed = streamEventSchema.safeParse(p.output)
  return parsed.success ? parsed.data : null
}

/**
 * Drain a Mastra workflow chunk iterable into an `EventWriter`. Each chunk is
 * passed through `unwrapStepOutput`; recognised `StreamEvent` payloads are
 * forwarded to the writer, and lifecycle chunks (`workflow-start`,
 * `workflow-finish`, `workflow-step-start`, ...) are silently dropped.
 *
 * Returns when the chunk iterable is exhausted. Does NOT close the writer -
 * the caller decides when to close it (typically after `output.result` has
 * resolved and any final terminal events have been emitted).
 */
export async function forwardWorkflowChunks(
  chunks: AsyncIterable<unknown>,
  writer: EventWriter,
): Promise<void> {
  for await (const chunk of chunks) {
    const event = unwrapStepOutput(chunk)
    if (event) await writer.write(event)
  }
}

export const STREAM_HEADERS: HeadersInit = {
  // application/x-ndjson is the conventional content type for newline-delimited
  // JSON. It signals "streaming" to proxies more reliably than application/json
  // and discourages clients from buffering the whole body before parsing.
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  // Discourage proxies from buffering streamed bodies.
  'X-Accel-Buffering': 'no',
}
