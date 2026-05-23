/**
 * Inline sanity tests for `parseAppStoreUrl`.
 *
 * Run with:  npm run test:url-parser --workspace apps/mastra
 *
 * No framework. We assert with the built-in `node:assert/strict` and exit
 * non-zero on the first failure so this can slot into a manual checklist or
 * CI without ceremony.
 */
import { strict as assert } from 'node:assert'
import { parseAppStoreUrl } from './app-store-url'

interface ValidCase {
  name: string
  input: string
  expect: { appId: string; country: string; slug: string }
}

interface InvalidCase {
  name: string
  input: string
  expectKind: 'invalid_url' | 'not_apple' | 'malformed_path'
}

const validCases: ValidCase[] = [
  {
    name: 'spotify (brief example)',
    input: 'https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580',
    expect: { appId: '324684580', country: 'us', slug: 'spotify-music-and-podcasts' },
  },
  {
    name: 'trailing slash',
    input: 'https://apps.apple.com/gb/app/headspace-meditation-sleep/id493145008/',
    expect: { appId: '493145008', country: 'gb', slug: 'headspace-meditation-sleep' },
  },
  {
    name: 'with tracking query string',
    input: 'https://apps.apple.com/jp/app/calm-meditation/id571800810?mt=8',
    expect: { appId: '571800810', country: 'jp', slug: 'calm-meditation' },
  },
]

const invalidCases: InvalidCase[] = [
  {
    name: 'empty',
    input: '',
    expectKind: 'invalid_url',
  },
  {
    name: 'google play',
    input: 'https://play.google.com/store/apps/details?id=com.spotify.music',
    expectKind: 'not_apple',
  },
  {
    name: 'apple homepage',
    input: 'https://apps.apple.com/',
    expectKind: 'malformed_path',
  },
  {
    name: 'apple search results',
    input: 'https://apps.apple.com/us/search?term=meditation',
    expectKind: 'malformed_path',
  },
  {
    name: 'malformed id segment',
    input: 'https://apps.apple.com/us/app/spotify/idabc',
    expectKind: 'malformed_path',
  },
]

let failures = 0

for (const c of validCases) {
  const result = parseAppStoreUrl(c.input)
  try {
    assert.equal(result.ok, true, `${c.name}: expected ok=true, got error`)
    if (result.ok) {
      assert.equal(result.value.appId, c.expect.appId, `${c.name}: appId mismatch`)
      assert.equal(result.value.country, c.expect.country, `${c.name}: country mismatch`)
      assert.equal(result.value.slug, c.expect.slug, `${c.name}: slug mismatch`)
    }
    console.log(`  ok    valid: ${c.name}`)
  } catch (e) {
    failures++
    console.error(`  FAIL  valid: ${c.name}`)
    console.error(`        ${(e as Error).message}`)
  }
}

for (const c of invalidCases) {
  const result = parseAppStoreUrl(c.input)
  try {
    assert.equal(result.ok, false, `${c.name}: expected error, got ok`)
    if (!result.ok) {
      assert.equal(result.error.kind, c.expectKind, `${c.name}: error kind mismatch`)
    }
    console.log(`  ok    invalid: ${c.name}`)
  } catch (e) {
    failures++
    console.error(`  FAIL  invalid: ${c.name}`)
    console.error(`        ${(e as Error).message}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
}
console.log('\nAll URL parser tests passed.')
