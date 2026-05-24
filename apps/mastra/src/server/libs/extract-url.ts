/**
 * Extract an Apple App Store URL from arbitrary user text.
 *
 * We accept any token containing "apps.apple.com". The strict validation
 * (country, appId, slug parsing) happens later in `parseAppStoreUrl()`
 * inside the workflow, which emits a user-friendly error message when the
 * URL doesn't parse. This helper is just the lenient first pass that finds
 * a candidate substring in a chat message.
 */
export function extractAppStoreUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S*apps\.apple\.com\S*/i)
  return match ? match[0] : null
}
