/**
 * Single shared Scraper instance for the whole service.
 *
 * Tools should import { scraper } from here rather than constructing their own,
 * so swapping the implementation is a one-line change in this file.
 */
import { env } from '../env.ts'
import { FirecrawlScraper } from './firecrawl.ts'
import type { Scraper } from './types.ts'

export const scraper: Scraper = new FirecrawlScraper(env.FIRECRAWL_API_KEY)

export * from './types.ts'
export * from './app-store-url.ts'
