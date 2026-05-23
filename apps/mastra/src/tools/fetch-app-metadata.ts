/**
 * Mastra tool: fetchAppMetadata
 *
 * Thin wrapper around `fetchListing()` (apps/mastra/src/scrape/fetch-listing.ts).
 * The actual scraping logic lives there so workflow steps can call it without
 * synthesizing a ToolExecutionContext.
 *
 * Tool execute signature (verified against @mastra/core@1.36.0):
 *   execute?: (inputData: TSchemaIn, context: ToolExecutionContext) => Promise<TSchemaOut>
 */
import { createTool } from '@mastra/core/tools'
import { appListingSchema } from '@aso/shared'
import { z } from 'zod'
import { fetchListing } from '../scrape/fetch-listing'

const inputSchema = z.object({
  url: z.string().describe('Full Apple App Store listing URL pasted by the user.'),
})

const outputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), listing: appListingSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      kind: z.enum([
        'invalid_url',
        'not_apple',
        'malformed_path',
        'fetch_failed',
        'not_found',
        'parse_failed',
        'rate_limited',
      ]),
      message: z.string(),
    }),
  }),
])

export const fetchAppMetadata = createTool({
  id: 'fetch-app-metadata',
  description:
    "Resolve an Apple App Store URL to structured listing metadata: name, developer, category, icon, screenshots, preview video, description, subtitle, ratings, and what's new. Use this as the first step of any audit.",
  inputSchema,
  outputSchema,
  execute: async inputData => fetchListing(inputData.url),
})
