/**
 * Firecrawl-backed Scraper implementation.
 *
 * Verified against @mendable/firecrawl-js@4.24.2:
 *   - default export is the `Firecrawl` class extending FirecrawlClient.
 *   - `client.scrape(url, options)` returns a `Document` whose `.json` field
 *     holds the JSON-extracted payload when `formats: [{ type: 'json', ... }]`
 *     is requested.
 *   - On HTTP errors the SDK throws `SdkError` with `.status` and `.code`.
 *
 * Zod compatibility: we use Zod 4's native `z.toJSONSchema()` to convert our
 * extraction schema before handing it to Firecrawl. We previously used the
 * third-party `zod-to-json-schema` package, but it only understands Zod 3
 * instances and silently produces an empty `{}` schema when given a Zod 4
 * instance - which makes Firecrawl extract nothing and return an empty
 * Document with no `json` field.
 */
import Firecrawl, { SdkError } from '@mendable/firecrawl-js'
import { z } from 'zod'
import {
  err,
  ok,
  type PageMetadata,
  type Result,
  type Scraper,
  type ScrapeSuccess,
  type ScraperError,
  type ScrapeOptions,
  zodErrorToScraperError,
} from './types'

export class FirecrawlScraper implements Scraper {
  private readonly client: Firecrawl

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('FirecrawlScraper: apiKey is required.')
    }
    this.client = new Firecrawl({ apiKey })
  }

  async extract<TSchema extends z.ZodType>(
    options: ScrapeOptions<TSchema>,
  ): Promise<Result<ScrapeSuccess<z.infer<TSchema>>, ScraperError>> {
    const { url, schema, prompt } = options

    // Convert Zod 4 -> JSON Schema using Zod's native exporter.
    // `unrepresentable: 'any'` keeps the conversion tolerant for any inner
    // type (e.g. dates) that has no canonical JSON Schema form; our
    // extraction schema today is pure JSON-friendly, but this keeps the call
    // future-proof and consistent with the rest of the service.
    const jsonSchema = z.toJSONSchema(schema, {
      target: 'draft-7',
      unrepresentable: 'any',
    }) as Record<string, unknown>

    let doc
    try {
      doc = await this.client.scrape(url, {
        formats: [
          {
            type: 'json',
            schema: jsonSchema,
            ...(prompt ? { prompt } : {}),
          },
        ],
        onlyMainContent: false,
      })
    } catch (e) {
      if (e instanceof SdkError) {
        if (e.status === 404) {
          return err({
            kind: 'not_found',
            message:
              'The App Store listing could not be found (404). The app may be delisted or unavailable in the requested country.',
            cause: e,
          })
        }
        if (e.status === 429) {
          return err({
            kind: 'rate_limited',
            message: 'Firecrawl rate limit reached. Wait a moment and try again.',
            cause: e,
          })
        }
        return err({
          kind: 'fetch_failed',
          message:
            e.message ||
            `Firecrawl returned HTTP ${e.status ?? '???'} while scraping the App Store listing.`,
          cause: e,
        })
      }
      return err({
        kind: 'fetch_failed',
        message: 'Could not reach Firecrawl. Check your network connection and FIRECRAWL_API_KEY.',
        cause: e,
      })
    }

    const raw = doc?.json
    if (raw == null) {
      // Surface whatever clue Firecrawl gave us. `doc.warning` is the
      // SDK-level diagnostic field; `doc.metadata.error` is the
      // page-level error (e.g. extractor failure). If both are empty,
      // the most common cause is an empty JSON schema being sent - hence
      // the diagnostic suffix.
      const warning = doc?.warning ?? doc?.metadata?.error
      return err({
        kind: 'parse_failed',
        message: warning
          ? `Firecrawl returned no extracted JSON: ${warning}`
          : 'Firecrawl returned no extracted JSON for the App Store listing. The page may be behind a bot challenge, or the extraction schema may be empty.',
      })
    }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return err(zodErrorToScraperError(parsed.error))
    }
    // Firecrawl returns its own ogImage field on the document metadata,
    // pulled from `<meta property="og:image">` in the page head. For App
    // Store listings this is the canonical 1024x1024 icon; the markup the
    // LLM sees usually contains only the lazy-load placeholder gif.
    const ogImageRaw = (doc?.metadata as { ogImage?: unknown } | undefined)?.ogImage
    const pageMetadata: PageMetadata = {
      ogImage: typeof ogImageRaw === 'string' && ogImageRaw.length > 0 ? ogImageRaw : null,
    }
    return ok({ data: parsed.data, pageMetadata })
  }
}
