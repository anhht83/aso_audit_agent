/**
 * Apple App Store URL validation + extraction.
 *
 * Spec: a valid URL has hostname ending in `apps.apple.com` and a path matching
 *   /<country>/app/<slug>/id<digits>
 *
 * We use the WHATWG URL parser (built-in) for hostname checks and a single
 * regex on the path. No String.split() ladder, no surprise edge cases like
 * trailing slashes or query strings.
 */
import { err, ok, type Result } from './types'

export type AppStoreUrlError =
  | { kind: 'invalid_url'; message: string }
  | { kind: 'not_apple'; message: string }
  | { kind: 'malformed_path'; message: string }

export interface ParsedAppStoreUrl {
  appId: string
  country: string
  slug: string
  /** Canonicalized URL: `https://apps.apple.com/<country>/app/<slug>/id<appId>` */
  canonicalUrl: string
}

// Two-letter ISO country code, lowercase. Anything else is rejected.
const PATH_RE = /^\/([a-z]{2})\/app\/([^/]+)\/id(\d+)\/?$/i

export function parseAppStoreUrl(input: string): Result<ParsedAppStoreUrl, AppStoreUrlError> {
  if (typeof input !== 'string' || input.trim() === '') {
    return err({
      kind: 'invalid_url',
      message: 'No URL provided.',
    })
  }

  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return err({
      kind: 'invalid_url',
      message: `Could not parse "${input}" as a URL. Expected an Apple App Store URL like https://apps.apple.com/us/app/<slug>/id<digits>.`,
    })
  }

  const host = url.hostname.toLowerCase()
  if (host !== 'apps.apple.com' && !host.endsWith('.apps.apple.com')) {
    return err({
      kind: 'not_apple',
      message: `Only Apple App Store URLs are supported. Got host "${host}".`,
    })
  }

  const match = PATH_RE.exec(url.pathname)
  if (!match) {
    return err({
      kind: 'malformed_path',
      message: `The URL path does not match the expected Apple App Store format. Expected /<country>/app/<slug>/id<digits>, got "${url.pathname}".`,
    })
  }

  // PATH_RE has three capture groups; with strict null checks we narrow defensively.
  const country = match[1]!.toLowerCase()
  const slug = match[2]!
  const appId = match[3]!

  return ok({
    appId,
    country,
    slug,
    canonicalUrl: `https://apps.apple.com/${country}/app/${slug}/id${appId}`,
  })
}
