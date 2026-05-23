/**
 * Newline-delimited JSON stream reader, built on standard Web Streams.
 *
 * Pipeline: response.body  ->  TextDecoderStream  ->  splitLines  ->  parseJson
 *
 * No SSE framing. The server writes one JSON object per line into a
 * ReadableStream and we decode the same way on this side. Back-pressure works
 * automatically through pipeThrough/pipeTo.
 */

/**
 * TransformStream that emits one string per complete `\n`-terminated line.
 * Buffers an incomplete trailing line across chunks; flushes any leftover
 * (non-empty) buffer when the upstream closes.
 */
function splitLines(): TransformStream<string, string> {
  let buffer = ''
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (line !== '') controller.enqueue(line)
      }
    },
    flush(controller) {
      const tail = buffer.replace(/\r$/, '')
      if (tail !== '') controller.enqueue(tail)
      buffer = ''
    },
  })
}

/**
 * TransformStream that JSON.parses each line. Drops lines that fail to parse
 * after logging - a corrupt line should not kill the entire stream.
 */
function parseJson<T = unknown>(): TransformStream<string, T> {
  return new TransformStream({
    transform(line, controller) {
      try {
        controller.enqueue(JSON.parse(line) as T)
      } catch {
        // eslint-disable-next-line no-console
        console.warn('Dropping malformed JSON line from stream:', line)
      }
    },
  })
}

/**
 * Async iterator over decoded events from a streaming Response body.
 *
 * Usage:
 *   for await (const event of readEventStream(response)) { ... }
 */
export async function* readEventStream(response: Response): AsyncGenerator<unknown> {
  if (!response.body) {
    throw new Error('No response body to read.')
  }

  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(splitLines())
    .pipeThrough(parseJson())

  // ReadableStream is async-iterable in modern runtimes; the Symbol.asyncIterator
  // path is supported in Chrome/Edge/Firefox/Safari and Node 18+. We use a
  // reader explicitly here so the contract is the same everywhere and we get
  // proper cleanup via `releaseLock()` on early break / throw.
  const reader = stream.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}
