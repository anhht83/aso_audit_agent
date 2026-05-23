/**
 * Single shared Scraper instance for the whole service.
 *
 * Scrape entry points import { scraper } from here rather than constructing
 * their own, so swapping the implementation is a one-line change in this file.
 * Sibling files in this folder hold the available `Scraper` implementations.
 */
import { env } from '../../env'
import { FirecrawlScraper } from './firecrawl'
import type { Scraper } from './types'

export const scraper: Scraper = new FirecrawlScraper(env.FIRECRAWL_API_KEY)
