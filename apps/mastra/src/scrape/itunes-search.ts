/**
 * Apple iTunes Search API client.
 *
 * Free, JSON, no API key. Used to find competitors in the same category without
 * burning Firecrawl quota or relying on chart-page scraping. The /search endpoint
 * accepts `term`, `country`, `media`, `entity`, `limit`. We then scrape each
 * competitor's listing page via Firecrawl to get the same shape as the subject.
 *
 * We use `term` rather than `genreId` because genre IDs are documented but
 * unstable in practice, and a search for the category name returns the top
 * apps in that category for free.
 *
 * Endpoint reference:
 *   https://itunes.apple.com/search?term=<term>&country=<cc>&media=software&entity=software&limit=<n>
 */
import { err, ok, type Result } from './types.ts'

export interface ItunesSearchResult {
  appId: string
  bundleId: string
  name: string
  developer: string
  primaryGenre: string
  url: string
}

export interface ItunesSearchError {
  kind: 'fetch_failed' | 'parse_failed'
  message: string
  cause?: unknown
}

interface ItunesSearchRaw {
  resultCount: number
  results: Array<{
    trackId?: number
    trackName?: string
    bundleId?: string
    artistName?: string
    primaryGenreName?: string
    trackViewUrl?: string
  }>
}

export async function searchItunes(opts: {
  term: string
  country: string
  limit?: number
}): Promise<Result<ItunesSearchResult[], ItunesSearchError>> {
  const url = new URL('https://itunes.apple.com/search')
  url.searchParams.set('term', opts.term)
  url.searchParams.set('country', opts.country)
  url.searchParams.set('media', 'software')
  url.searchParams.set('entity', 'software')
  url.searchParams.set('limit', String(opts.limit ?? 10))

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    return err({
      kind: 'fetch_failed',
      message: 'Could not reach the Apple iTunes Search API.',
      cause: e,
    })
  }

  if (!response.ok) {
    return err({
      kind: 'fetch_failed',
      message: `iTunes Search API returned HTTP ${response.status}.`,
    })
  }

  let raw: ItunesSearchRaw
  try {
    raw = (await response.json()) as ItunesSearchRaw
  } catch (e) {
    return err({
      kind: 'parse_failed',
      message: 'iTunes Search API returned a body that could not be parsed as JSON.',
      cause: e,
    })
  }

  if (!Array.isArray(raw.results)) {
    return err({
      kind: 'parse_failed',
      message: 'iTunes Search API response is missing a results array.',
    })
  }

  const results: ItunesSearchResult[] = raw.results
    .filter(
      (r): r is Required<Pick<typeof r, 'trackId' | 'trackName' | 'bundleId' | 'artistName' | 'primaryGenreName' | 'trackViewUrl'>> =>
        typeof r.trackId === 'number' &&
        typeof r.trackName === 'string' &&
        typeof r.bundleId === 'string' &&
        typeof r.artistName === 'string' &&
        typeof r.primaryGenreName === 'string' &&
        typeof r.trackViewUrl === 'string',
    )
    .map(r => ({
      appId: String(r.trackId),
      bundleId: r.bundleId,
      name: r.trackName,
      developer: r.artistName,
      primaryGenre: r.primaryGenreName,
      url: r.trackViewUrl,
    }))

  return ok(results)
}
