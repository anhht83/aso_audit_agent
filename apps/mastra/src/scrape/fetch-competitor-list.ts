/**
 * Plain async function: given a subject app's category/country/appId, find up
 * to N CompetitorSummary objects in the same category.
 *
 * Two-stage sourcing:
 *   1. iTunes Search API for the candidate list (free, no key).
 *   2. Firecrawl, one scrape per competitor, for enrichment fields the audit
 *      table needs (subtitle, screenshot count, preview-video presence, rating).
 *
 * Like fetchListing, this is the plain function form. The `fetchCompetitors`
 * Mastra tool wraps it for agent invocation; the workflow step calls it
 * directly.
 */
import type { CompetitorSummary } from '@aso/shared'
import { z } from 'zod'
import { scraper } from './index'
import { searchItunes, type ItunesSearchResult } from './itunes-search'

export interface FetchCompetitorListArgs {
  category: string
  country: string
  excludeAppId: string
  limit?: number
}

export interface FetchCompetitorListResult {
  competitors: CompetitorSummary[]
  /** Present only on partial/full failure. Safe to surface to the user. */
  warning?: string
}

const competitorExtractionSchema = z.object({
  subtitle: z.string().nullable(),
  screenshotCount: z.number().describe('Total count of screenshot images on the listing.'),
  hasPreviewVideo: z
    .boolean()
    .describe('True if the listing has at least one App Preview video.'),
  averageRating: z.number().nullable(),
  ratingCount: z.number().nullable(),
})

async function enrichCompetitor(candidate: ItunesSearchResult): Promise<CompetitorSummary> {
  const fallback: CompetitorSummary = {
    appId: candidate.appId,
    name: candidate.name,
    developer: candidate.developer,
    title: candidate.name,
    subtitle: null,
    averageRating: null,
    ratingCount: null,
    screenshotCount: 0,
    hasPreviewVideo: false,
  }

  const scrape = await scraper.extract({
    url: candidate.url,
    schema: competitorExtractionSchema,
    prompt:
      'Extract the subtitle (or null), the number of screenshot images, whether a preview video is present, the average rating, and the total rating count.',
  })

  if (!scrape.ok) {
    return fallback
  }

  return {
    ...fallback,
    subtitle: scrape.value.subtitle,
    averageRating: scrape.value.averageRating,
    ratingCount:
      scrape.value.ratingCount === null ? null : Math.max(0, Math.trunc(scrape.value.ratingCount)),
    screenshotCount: Math.max(0, Math.trunc(scrape.value.screenshotCount)),
    hasPreviewVideo: scrape.value.hasPreviewVideo,
  }
}

export async function fetchCompetitorList(
  args: FetchCompetitorListArgs,
): Promise<FetchCompetitorListResult> {
  const { category, country, excludeAppId } = args
  const limit = args.limit ?? 3

  const search = await searchItunes({ term: category, country, limit: limit + 3 })
  if (!search.ok) {
    return {
      competitors: [],
      warning: `Competitor data unavailable: ${search.error.message}`,
    }
  }

  const candidates = search.value
    .filter(c => c.appId !== excludeAppId)
    .filter(c => c.primaryGenre.toLowerCase() === category.toLowerCase())
    .slice(0, limit)

  if (candidates.length === 0) {
    // Loose fallback: iTunes Search term-match isn't perfect; if no candidate
    // passes the category equality filter, take the top non-subject results.
    const looseCandidates = search.value.filter(c => c.appId !== excludeAppId).slice(0, limit)
    if (looseCandidates.length === 0) {
      return {
        competitors: [],
        warning: 'Competitor data unavailable: no other apps found in this category.',
      }
    }
    const enriched = await Promise.all(looseCandidates.map(enrichCompetitor))
    return { competitors: enriched }
  }

  const enriched = await Promise.all(candidates.map(enrichCompetitor))
  return { competitors: enriched }
}
