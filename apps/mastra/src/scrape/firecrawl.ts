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
 * Zod compatibility: Firecrawl's bundled zod is v3, ours is v4. We convert
 * our Zod 4 extraction schema to JSON Schema with `zod-to-json-schema` before
 * handing it to Firecrawl. Firecrawl accepts either, per the JsonFormat type.
 */
import Firecrawl, { SdkError } from '@mendable/firecrawl-js'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  err,
  ok,
  type Result,
  type Scraper,
  type ScraperError,
  type ScrapeOptions,
  zodErrorToScraperError,
} from './types.ts'

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
  ): Promise<Result<z.infer<TSchema>, ScraperError>> {
    const { url, schema, prompt } = options

    // Convert Zod 4 -> JSON Schema. We strip the meta keys Firecrawl rejects.
    const jsonSchema = zodToJsonSchema(schema, {
      // Inline definitions so we don't ship a $ref-heavy doc.
      $refStrategy: 'none',
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
      return err({
        kind: 'parse_failed',
        message: 'Firecrawl returned no extracted JSON for the App Store listing.',
      })
    }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return err(zodErrorToScraperError(parsed.error))
    }
    return ok(parsed.data)
  }
}
