/**
 * Validated environment configuration.
 *
 * Imported once at startup. On missing/invalid env vars we fail loudly with a
 * message pointing at `.env.example` rather than letting the service start and
 * 500 on first request.
 *
 * Env file loading is owned by the Mastra CLI: `mastra dev` reads
 * `apps/mastra/.env` automatically. We do NOT walk up the directory tree
 * looking for a shared root .env - each app has its own .env file
 * (apps/mastra/.env for this service, apps/web/.env.local for Next.js).
 */
import { z } from 'zod'

const envSchema = z.object({
  FIRECRAWL_API_KEY: z
    .string()
    .min(1, 'Missing FIRECRAWL_API_KEY - see apps/mastra/.env.example. Get a free key at https://firecrawl.dev.'),
  LLM_BASE_URL: z
    .string()
    .url('LLM_BASE_URL must be a full URL (e.g. https://integrate.api.nvidia.com/v1).')
    .default('https://integrate.api.nvidia.com/v1'),
  LLM_API_KEY: z
    .string()
    .min(1, 'Missing LLM_API_KEY - see apps/mastra/.env.example. For NVIDIA NIM, sign up at https://build.nvidia.com.'),
  LLM_MODEL: z.string().min(1).default('meta/llama-3.3-70b-instruct'),
  MASTRA_PORT: z.coerce.number().int().positive().default(4111),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n')
    // Emit to stderr, then exit. Don't throw - throws get swallowed by `mastra dev`'s
    // worker thread and the user sees only an unhelpful stack.
    process.stderr.write(
      [
        '',
        'Invalid environment configuration:',
        issues,
        '',
        'Copy apps/mastra/.env.example to apps/mastra/.env and fill in the values.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  return parsed.data
}

export const env: Env = loadEnv()
