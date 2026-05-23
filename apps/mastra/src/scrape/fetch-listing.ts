/**
 * Plain async function for resolving an App Store URL to an AppListing.
 *
 * Both the `fetchAppMetadata` Mastra tool (for agent use) and the audit
 * workflow's `resolveListing` step (called directly) wrap this. Keeping the
 * core logic outside the Mastra tool wrapper avoids the awkward
 * `tool.execute(input, ctx)` invocation from workflow steps, which would
 * otherwise require synthesizing a `ToolExecutionContext` we don't have.
 */
import { appListingSchema, type AppListing } from '@aso/shared'
import { z } from 'zod'
import { parseAppStoreUrl } from './app-store-url'
import { scraper } from './index'

export type FetchListingFailure = {
  kind:
    | 'invalid_url'
    | 'not_apple'
    | 'malformed_path'
    | 'fetch_failed'
    | 'not_found'
    | 'parse_failed'
    | 'rate_limited'
  message: string
}

export type FetchListingResult =
  | { ok: true; listing: AppListing }
  | { ok: false; error: FetchListingFailure }

/**
 * Zod schema we hand to Firecrawl's JSON extractor. Field shapes mirror
 * AppListing but with everything tolerant up front - the App Store listing
 * markup varies by app, and we'd rather get a partial result we can validate
 * ourselves than have Firecrawl bail because one field was missing.
 */
const extractionSchema = z
  .object({
    name: z.string().describe('App name shown at the top of the listing.'),
    developer: z.string().describe('Developer / publisher name.'),
    category: z.string().describe('Primary category shown on the listing.'),
    iconUrl: z.string().describe('Direct URL to the app icon image.'),
    screenshotUrls: z
      .array(z.string())
      .describe('All screenshot image URLs in display order.'),
    previewVideoUrl: z
      .string()
      .nullable()
      .describe('App preview video URL if present, else null.'),
    description: z.string().describe('Full long description text.'),
    subtitle: z
      .string()
      .nullable()
      .describe('Subtitle text below the app name, or null if not present.'),
    currentVersion: z
      .string()
      .nullable()
      .describe('Current version number, or null if not visible.'),
    whatsNew: z
      .string()
      .nullable()
      .describe("What's New text from the latest update, or null if not visible."),
    averageRating: z
      .number()
      .nullable()
      .describe('Average star rating shown on the listing (1.0-5.0) or null.'),
    ratingCount: z
      .number()
      .nullable()
      .describe('Total rating count shown on the listing, or null.'),
    promotionalText: z
      .string()
      .nullable()
      .describe('Promotional text shown above the description, or null.'),
  })
  .describe('App Store listing fields')

export async function fetchListing(url: string): Promise<FetchListingResult> {
  const parsed = parseAppStoreUrl(url)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  const { appId, country, canonicalUrl } = parsed.value

  const scrape = await scraper.extract({
    url: canonicalUrl,
    schema: extractionSchema,
    prompt:
      'Extract the App Store listing fields exactly as they appear on the page. Use null for any field that is not present on the listing. Do not invent values.',
  })

  if (!scrape.ok) {
    return { ok: false, error: scrape.error }
  }

  const listing: AppListing = {
    appId,
    country,
    url: canonicalUrl,
    name: scrape.value.name,
    developer: scrape.value.developer,
    category: scrape.value.category,
    iconUrl: scrape.value.iconUrl,
    screenshotUrls: scrape.value.screenshotUrls,
    previewVideoUrl: scrape.value.previewVideoUrl,
    description: scrape.value.description,
    subtitle: scrape.value.subtitle,
    currentVersion: scrape.value.currentVersion,
    whatsNew: scrape.value.whatsNew,
    averageRating: scrape.value.averageRating,
    ratingCount: scrape.value.ratingCount,
    promotionalText: scrape.value.promotionalText,
  }

  const final = appListingSchema.safeParse(listing)
  if (!final.success) {
    return {
      ok: false,
      error: {
        kind: 'parse_failed',
        message:
          'The App Store listing was fetched but some fields did not match the expected shape. The page layout may have changed.',
      },
    }
  }
  return { ok: true, listing: final.data }
}
