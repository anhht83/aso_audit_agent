/**
 * Public contract of the scraper subsystem.
 *
 * Anything that wants to USE a scraper depends on the `Scraper` interface (and
 * its surrounding `ScrapeOptions`/`ScrapeSuccess`/`ScraperError` shapes) from
 * here. Concrete provider implementations (Firecrawl today, potentially a
 * `fetch + cheerio` fallback tomorrow) live as siblings in this folder and
 * `scraper/index.ts` picks which one is the singleton.
 *
 * Generic `Result<T, E>` / `ok` / `err` primitives intentionally live one
 * level up in `../types` because non-scraper code in `scrape/` (e.g. the URL
 * parser, the iTunes search client) also uses them.
 */
import { type z, ZodError } from 'zod'
import type { Result } from '../types'

export type ScraperErrorKind =
  | 'fetch_failed' // Network / Firecrawl service error
  | 'not_found' // 404 - app delisted, region-blocked, etc.
  | 'parse_failed' // Got HTML but couldn't extract the schema we asked for
  | 'rate_limited' // Firecrawl told us to slow down

export interface ScraperError {
  kind: ScraperErrorKind
  /** Human-readable message safe to surface to the user. */
  message: string
  /** Underlying cause for logs; never shown to the user. */
  cause?: unknown
}

export interface ScrapeOptions<TSchema extends z.ZodType> {
  url: string
  /**
   * Zod schema describing the data we want extracted from the page. We
   * convert to JSON Schema before handing to Firecrawl - it accepts both Zod
   * and JSON Schema, but since their bundled zod is v3 we cannot safely pass
   * a Zod 4 instance directly.
   */
  schema: TSchema
  /** Optional LLM-extract prompt to guide the structured extraction. */
  prompt?: string
}

/**
 * Page-level metadata pulled from the response that doesn't come from the
 * structured LLM extraction. Useful when the page exposes high-quality
 * canonical values (e.g. `<meta property="og:image">` for an app's icon)
 * that the LLM might otherwise misread - Apple's App Store, for instance,
 * lazy-loads icons and screenshots from a 1x1 placeholder gif, so the
 * extracted iconUrl is unreliable while the og:image is the real artwork.
 */
export interface PageMetadata {
  /** `<meta property="og:image">` value if present. */
  ogImage?: string | null
}

export interface ScrapeSuccess<T> {
  data: T
  pageMetadata: PageMetadata
}

/**
 * Provider-agnostic scraper interface. Implementations: Firecrawl (default),
 * potentially `fetch + cheerio` as a fallback. Tools, agents, and workflows
 * MUST depend on this interface, never on a specific implementation.
 */
export interface Scraper {
  extract<TSchema extends z.ZodType>(
    options: ScrapeOptions<TSchema>,
  ): Promise<Result<ScrapeSuccess<z.infer<TSchema>>, ScraperError>>
}

/**
 * Helper for implementations: convert a Zod parse error into a typed scraper
 * error with a useful message.
 */
export function zodErrorToScraperError(error: ZodError): ScraperError {
  const firstIssue = error.issues[0]
  const hint = firstIssue
    ? `${firstIssue.path.join('.') || '(root)'}: ${firstIssue.message}`
    : 'schema mismatch'
  return {
    kind: 'parse_failed',
    message: `Could not parse the App Store listing into the expected shape (${hint}).`,
    cause: error,
  }
}
