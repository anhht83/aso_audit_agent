/**
 * Firecrawl-backed Scraper implementation using the v2 HTTP API directly.
 *
 * We deliberately do NOT use the official `@mendable/firecrawl-js` SDK:
 *   - Calling the JSON endpoint with plain `fetch` removes a dependency and
 *     keeps the request/response shape transparent (one place to inspect
 *     everything we send and receive).
 *   - The SDK historically bundled its own Zod 3 export, which conflicted
 *     with our Zod 4-based extraction schemas. Going direct sidesteps that
 *     class of compatibility bug entirely.
 *
 * Endpoint: POST https://api.firecrawl.dev/v2/scrape
 * Auth:     Bearer <FIRECRAWL_API_KEY>
 *
 * Response model (verified against the v2 OpenAPI spec):
 *   {
 *     success: boolean,
 *     data: {
 *       json: unknown,                   // present when we request the json format
 *       metadata: {
 *         statusCode?: number,           // upstream page status (Firecrawl 200 + 404 here = page-not-found)
 *         error?: string | null,
 *         ogImage?: string,              // <meta property="og:image"> value
 *         ...
 *       },
 *       warning?: string | null,
 *     },
 *     error?: string,
 *     code?: string,
 *   }
 *
 * Zod compatibility: we use Zod 4's native `z.toJSONSchema()` to convert our
 * extraction schema before sending it. `unrepresentable: 'any'` keeps the
 * conversion tolerant for any inner type that has no canonical JSON Schema
 * form; our schemas today are pure JSON-friendly, but this future-proofs the
 * boundary.
 */
import { z } from 'zod'
import { err, ok, type Result } from '../types'
import {
  type PageMetadata,
  type Scraper,
  type ScrapeSuccess,
  type ScraperError,
  type ScrapeOptions,
  zodErrorToScraperError,
} from './types'

const SCRAPE_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape'

/** Default Firecrawl-side cache window: serve a cached page if younger than 2 days. */
const DEFAULT_MAX_AGE_MS = 172_800_000

/**
 * Subset of the v2 /scrape response we actually consume. Firecrawl returns
 * many more fields (markdown, html, links, branding, ...) - we only model
 * the ones the audit pipeline reads.
 */
interface FirecrawlScrapeResponse {
  success?: boolean
  data?: {
    json?: unknown
    metadata?: {
      statusCode?: number
      error?: string | null
      ogImage?: string
      [key: string]: unknown
    }
    warning?: string | null
  }
  error?: string
  code?: string
}

export class FirecrawlScraper implements Scraper {
  private readonly apiKey: string

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('FirecrawlScraper: apiKey is required.')
    }
    this.apiKey = apiKey
  }

  async extract<TSchema extends z.ZodType>(
    options: ScrapeOptions<TSchema>,
  ): Promise<Result<ScrapeSuccess<z.infer<TSchema>>, ScraperError>> {
    const { url, schema, prompt } = options

    const jsonSchema = z.toJSONSchema(schema, {
      target: 'draft-7',
      unrepresentable: 'any',
    }) as Record<string, unknown>

    const body = {
      url,
      formats: [
        {
          type: 'json' as const,
          schema: jsonSchema,
          ...(prompt ? { prompt } : {}),
        },
      ],
      onlyMainContent: true,
      maxAge: DEFAULT_MAX_AGE_MS,
    }

    let response: Response
    try {
      response = await fetch(SCRAPE_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      return err({
        kind: 'fetch_failed',
        message:
          'Could not reach Firecrawl. Check your network connection and FIRECRAWL_API_KEY.',
        cause: e,
      })
    }

    let payload: FirecrawlScrapeResponse | null = null
    try {
      payload = (await response.json()) as FirecrawlScrapeResponse
    } catch (e) {
      // Non-JSON response (rare) - surface what we know via the HTTP status.
      return err({
        kind: 'fetch_failed',
        message: `Firecrawl returned a non-JSON response (HTTP ${response.status}).`,
        cause: e,
      })
    }

    if (!response.ok) {
      // Map documented v2 error codes to our typed shapes. 404 isn't a
      // documented top-level Firecrawl status, but if the SDK ever started
      // surfacing one we'd want to translate it consistently.
      if (response.status === 429) {
        return err({
          kind: 'rate_limited',
          message:
            payload?.error ?? 'Firecrawl rate limit reached. Wait a moment and try again.',
          cause: payload,
        })
      }
      if (response.status === 404) {
        return err({
          kind: 'not_found',
          message:
            payload?.error ??
            'The App Store listing could not be found (404). The app may be delisted or unavailable in the requested country.',
          cause: payload,
        })
      }
      return err({
        kind: 'fetch_failed',
        message:
          payload?.error ??
          `Firecrawl returned HTTP ${response.status} while scraping the App Store listing.`,
        cause: payload,
      })
    }

    // HTTP 200 OK from Firecrawl can still wrap an upstream-page failure:
    // the scrape succeeded but the page Firecrawl visited returned an error.
    const upstreamStatus = payload?.data?.metadata?.statusCode
    if (typeof upstreamStatus === 'number' && upstreamStatus === 404) {
      return err({
        kind: 'not_found',
        message:
          'The App Store listing could not be found (404). The app may be delisted or unavailable in the requested country.',
        cause: payload,
      })
    }

    const rawJson = payload?.data?.json
    if (rawJson == null) {
      // Surface whatever clue Firecrawl gave us. `data.warning` is the
      // SDK-level diagnostic field; `data.metadata.error` is the
      // page-level error (e.g. extractor failure). If both are empty,
      // the most common cause is an empty JSON schema being sent -
      // hence the diagnostic suffix.
      const warning = payload?.data?.warning ?? payload?.data?.metadata?.error
      return err({
        kind: 'parse_failed',
        message: warning
          ? `Firecrawl returned no extracted JSON: ${warning}`
          : 'Firecrawl returned no extracted JSON for the App Store listing. The page may be behind a bot challenge, or the extraction schema may be empty.',
      })
    }

    const parsed = schema.safeParse(rawJson)
    if (!parsed.success) {
      return err(zodErrorToScraperError(parsed.error))
    }

    // Firecrawl exposes the page's <meta property="og:image"> on the
    // response metadata. For App Store listings this is the canonical
    // 1024x1024 icon; the rendered markup the LLM sees usually contains
    // only the lazy-load placeholder gif, so we prefer this value
    // downstream in fetch-listing.ts.
    const ogImageRaw = payload?.data?.metadata?.ogImage
    const pageMetadata: PageMetadata = {
      ogImage:
        typeof ogImageRaw === 'string' && ogImageRaw.length > 0 ? ogImageRaw : null,
    }
    return ok({ data: parsed.data, pageMetadata })
  }
}
