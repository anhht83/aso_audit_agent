/**
 * Mastra tool: fetchCompetitors
 *
 * Thin wrapper around `fetchCompetitorList()` (apps/mastra/src/scrape/fetch-competitor-list.ts).
 * The actual lookup logic lives there so workflow steps can call it without
 * synthesizing a ToolExecutionContext.
 */
import { createTool } from '@mastra/core/tools'
import { competitorSummarySchema } from '@aso/shared'
import { z } from 'zod'
import { fetchCompetitorList } from '../scrape/fetch-competitor-list.ts'

const inputSchema = z.object({
  category: z.string().describe('Primary App Store category of the subject app, e.g. "Music".'),
  country: z.string().length(2).describe('ISO two-letter country code of the storefront.'),
  excludeAppId: z.string().describe('Numeric appId of the subject app, excluded from the result.'),
  limit: z.number().int().min(1).max(5).default(3).describe('How many competitors to return.'),
})

const outputSchema = z.object({
  competitors: z.array(competitorSummarySchema),
  warning: z.string().optional(),
})

export const fetchCompetitors = createTool({
  id: 'fetch-competitors',
  description:
    'Find up to three competing apps in the same App Store category and return a CompetitorSummary for each. Skip this tool if the audit cannot proceed without competitor data; on partial failure it returns an empty list with a warning.',
  inputSchema,
  outputSchema,
  execute: async inputData =>
    fetchCompetitorList({
      category: inputData.category,
      country: inputData.country,
      excludeAppId: inputData.excludeAppId,
      limit: inputData.limit,
    }),
})
