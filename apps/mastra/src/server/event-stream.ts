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
import type { StreamEvent } from '@aso/shared'

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

export const STREAM_HEADERS: HeadersInit = {
  // application/x-ndjson is the conventional content type for newline-delimited
  // JSON. It signals "streaming" to proxies more reliably than application/json
  // and discourages clients from buffering the whole body before parsing.
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  // Discourage proxies from buffering streamed bodies.
  'X-Accel-Buffering': 'no',
}
