/**
 * LLM model factory.
 *
 * We use Mastra's OpenAI-compatible endpoint pattern: pass `{ id, url, apiKey }`
 * to the agent's `model` field and Mastra routes through its OpenAI-compatible
 * client. This is the same shape Mastra recommends for LMStudio, vLLM, NVIDIA
 * NIM, and any other OpenAI-compatible inference server.
 *
 * Swap providers without code changes:
 *   - NVIDIA NIM (default):  LLM_BASE_URL=https://integrate.api.nvidia.com/v1
 *   - OpenAI:                LLM_BASE_URL=https://api.openai.com/v1
 *   - Local (LMStudio):      LLM_BASE_URL=http://localhost:1234/v1
 *   - Anthropic:             prefer Mastra's native `anthropic/<model>` string instead
 *
 * Anthropic doesn't speak OpenAI's protocol, so for that path use Mastra's
 * built-in provider routing (set ANTHROPIC_API_KEY and `model: 'anthropic/...'`
 * directly on the Agent rather than this factory).
 */
import { env } from '../env.ts'

/**
 * Returns a Mastra model descriptor pointing at the configured OpenAI-compatible
 * endpoint. We prefix the id with `nim/` so Mastra logs make it obvious which
 * provider was used, but it's just a label - the actual routing is by `url`.
 */
export function model() {
  return {
    id: `nim/${env.LLM_MODEL}`,
    url: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
  } as const
}
