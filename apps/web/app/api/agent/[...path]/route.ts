/**
 * Proxy from the Next.js app to the Mastra service.
 *
 * The browser hits /api/agent/<path...>; we forward to MASTRA_URL/<path...>
 * and stream the response body back unchanged (preserving the NDJSON stream).
 */
import { NextRequest } from 'next/server'

const MASTRA_URL = process.env.MASTRA_URL ?? 'http://localhost:4111'

// Streaming responses don't play well with caching or static optimization.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function forward(req: NextRequest, ctx: { params: { path: string[] } }) {
  const path = ctx.params.path.join('/')
  const target = `${MASTRA_URL}/${path}${req.nextUrl.search}`

  const headers = new Headers(req.headers)
  // Strip Next.js / Vercel-specific headers that confuse Mastra's server.
  headers.delete('host')
  headers.delete('connection')
  headers.delete('content-length')

  const init: RequestInit = {
    method: req.method,
    headers,
    // GET / HEAD shouldn't carry a body; everything else does.
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    // Required when forwarding a streaming body in Node fetch (undici).
    // @ts-expect-error duplex is a valid option in undici but not yet in lib.dom.
    duplex: 'half',
  }

  let upstream: Response
  try {
    upstream = await fetch(target, init)
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: `Could not reach the Mastra service at ${MASTRA_URL}. Is it running?`,
        cause: (e as Error).message,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Preserve content-type (application/x-ndjson) and pass the streamed body
  // through verbatim. Node fetch + Next.js do not buffer when we hand the
  // upstream `body` directly to a new Response.
  const respHeaders = new Headers(upstream.headers)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  })
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx)
}

export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx)
}
