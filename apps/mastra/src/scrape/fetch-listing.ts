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
 *
 * Reliability notes (Apple App Store markup, 2026-05):
 *   - The app icon and screenshots are lazy-loaded; the rendered markup
 *     contains only `/assets/artwork/1x1.gif` placeholders. We recover the
 *     canonical icon via the `og:image` head metadata in `fetchListing`
 *     below, so `iconUrl` here is nullable. `screenshotUrls` will almost
 *     always be empty after we strip the placeholder URLs, so the audit
 *     relies on the dedicated `screenshotCount` field for the Screenshots
 *     dimension.
 *   - "Free" appears prominently as the price label (NOT promotional text).
 *     `promotionalText` is the optional 170-char banner some apps surface
 *     above the description; if you don't see a distinct paragraph above
 *     the description, return null.
 *   - `ratingCount` is displayed with M/K suffixes ("40M Ratings"). The
 *     extractor must expand these to integers.
 */
const extractionSchema = z
  .object({
    name: z.string().describe('App name shown at the top of the listing.'),
    developer: z.string().describe('Developer / publisher name.'),
    category: z.string().describe('Primary category shown on the listing.'),
    iconUrl: z
      .string()
      .nullable()
      .describe(
        'Direct URL to the app icon image. Most listings only render a `/assets/artwork/1x1.gif` placeholder for the icon; if all you can see is a placeholder GIF, return null and let the service fall back to the og:image metadata.',
      ),
    screenshotUrls: z
      .array(z.string())
      .describe(
        'All screenshot image URLs in display order. Exclude any `apps.apple.com/assets/artwork/1x1.gif` placeholders — they are lazy-load skeletons, not real screenshots. Return an empty array if only placeholders are present.',
      ),
    screenshotCount: z
      .number()
      .int()
      .nullable()
      .describe(
        'Total number of screenshot slots on the listing, INCLUDING the lazy-load placeholders. Count the screenshot image bullets visible on the page (typical: 0-10). Return null only if no screenshot region is present at all.',
      ),
    previewVideoUrl: z
      .string()
      .nullable()
      .describe(
        'App preview video URL if present, else null. Apple lazy-loads video sources, so this is usually null even when a preview video exists; do not invent a URL.',
      ),
    description: z.string().describe('Full long description text.'),
    subtitle: z
      .string()
      .nullable()
      .describe('Subtitle text below the app name, or null if not present.'),
    currentVersion: z
      .string()
      .nullable()
      .describe(
        'Current version number (e.g. "9.1.48"), or null if not visible. Do NOT include the release date in this field.',
      ),
    whatsNew: z
      .string()
      .nullable()
      .describe(
        "What's New text from the latest update, or null if not visible. Use the most recent version's release notes, not the cumulative version history.",
      ),
    averageRating: z
      .number()
      .nullable()
      .describe('Average star rating shown on the listing (1.0-5.0) or null.'),
    ratingCount: z
      .number()
      .nullable()
      .describe(
        'Total rating count shown on the listing as an integer. Expand suffixes: "40M Ratings" → 40000000, "1.2K" → 1200. Return null if not visible.',
      ),
    promotionalText: z
      .string()
      .nullable()
      .describe(
        'The optional 170-character promotional banner some apps surface ABOVE the description. NOT the price label ("Free", "$0.99") or the In-App Purchase indicator. If you do not see a distinct paragraph of marketing copy above the long description, return null.',
      ),
    inAppEvents: z
      .array(
        z.object({
          title: z.string().describe('Event title as shown on the listing.'),
          status: z
            .string()
            .nullable()
            .describe(
              'Status label such as "HAPPENING NOW", "UPCOMING", or null if no status is shown.',
            ),
          subtitle: z
            .string()
            .nullable()
            .describe('Optional one-line subtitle / description shown under the event title.'),
        }),
      )
      .describe(
        'In-App Events currently surfaced on the listing (Apple\'s "Events" section). Empty array if none.',
      ),
    sampleReviews: z
      .array(
        z.object({
          title: z.string().describe('Review headline as shown on the listing.'),
          body: z.string().describe('Review body text.'),
        }),
      )
      .describe(
        'Up to 5 representative user reviews visible on the listing. Use them for sentiment/keyword signals; capture the title and body verbatim. Empty array if no reviews are shown.',
      ),
    versionHistory: z
      .array(
        z.object({
          version: z.string().describe('Version number, e.g. "9.1.48".'),
          date: z
            .string()
            .describe('Release date as shown on the listing, e.g. "May 15" or "12/17/2025".'),
        }),
      )
      .describe(
        'Up to 5 most recent entries from the Version History list, newest first. Used as a proxy for update cadence. Empty array if the version history is not visible.',
      ),
  })
  .describe('App Store listing fields')

/**
 * Apple renders lazy-loaded image bullets as a 1x1 transparent GIF until
 * the user scrolls. Strip those so the downstream pipeline never confuses
 * a placeholder for an actual screenshot.
 */
const PLACEHOLDER_IMAGE_PATTERN = /\/assets\/artwork\/1x1\.gif$/i

function isRealAssetUrl(u: string): boolean {
  if (!u) return false
  if (PLACEHOLDER_IMAGE_PATTERN.test(u)) return false
  return true
}

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

  const { data, pageMetadata } = scrape.value
  // Apple lazy-loads the icon from a 1x1 placeholder gif, so the LLM-
  // extracted iconUrl is almost always the placeholder
  // (https://apps.apple.com/assets/artwork/1x1.gif). Prefer the
  // server-rendered og:image, which Apple populates with the canonical
  // 1024x1024 artwork URL. Fall back to whatever the extraction returned
  // only if og:image is missing and the LLM happened to find a real URL.
  const ogImageUrl =
    pageMetadata.ogImage && isRealAssetUrl(pageMetadata.ogImage) ? pageMetadata.ogImage : null
  const extractedIconUrl =
    data.iconUrl && isRealAssetUrl(data.iconUrl) ? data.iconUrl : null
  const iconUrl = ogImageUrl ?? extractedIconUrl

  // Drop placeholder GIFs from the screenshot list so the audit sees the
  // ground truth (almost always: empty array, with `screenshotCount`
  // carrying the slot count).
  const screenshotUrls = (data.screenshotUrls ?? []).filter(isRealAssetUrl)

  // If iconUrl is still missing here we can't satisfy appListingSchema
  // (it requires a URL). Fail explicitly with a useful message rather than
  // letting the safeParse below produce a generic shape error.
  if (!iconUrl) {
    return {
      ok: false,
      error: {
        kind: 'parse_failed',
        message:
          'Could not resolve an app icon URL from the listing. The page may be behind a bot challenge, or Apple changed the og:image markup.',
      },
    }
  }

  // Reasonable upper bounds so a chatty LLM cannot blow up the audit prompt.
  const sampleReviews = (data.sampleReviews ?? []).slice(0, 5)
  const versionHistory = (data.versionHistory ?? []).slice(0, 5)
  const inAppEvents = data.inAppEvents ?? []

  const listing: AppListing = {
    appId,
    country,
    url: canonicalUrl,
    name: data.name,
    developer: data.developer,
    category: data.category,
    iconUrl,
    screenshotUrls,
    screenshotCount:
      data.screenshotCount === null ? null : Math.max(0, Math.trunc(data.screenshotCount)),
    previewVideoUrl: data.previewVideoUrl,
    description: data.description,
    subtitle: data.subtitle,
    currentVersion: data.currentVersion,
    whatsNew: data.whatsNew,
    averageRating: data.averageRating,
    ratingCount:
      data.ratingCount === null ? null : Math.max(0, Math.trunc(data.ratingCount)),
    promotionalText: data.promotionalText,
    inAppEvents,
    sampleReviews,
    versionHistory,
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
