/**
 * Generic Result<T, E> primitives shared across the scrape feature.
 *
 * Every scrape-side boundary (URL parsing, iTunes lookups, the `Scraper`
 * interface) uses these to model "either it worked or here's a typed error".
 * We deliberately do NOT throw on expected failures (404, parse failure,
 * rate limit) - those are domain outcomes the caller must handle. We still
 * throw on truly exceptional things (bad code path, programmer error).
 *
 * Scraper-specific types (the `Scraper` interface, `ScrapeOptions`,
 * `PageMetadata`, `ScraperError`, etc.) live next to the implementations in
 * `./scraper/types.ts`.
 */

export type Ok<T> = { ok: true; value: T }
export type Err<E> = { ok: false; error: E }
export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}
