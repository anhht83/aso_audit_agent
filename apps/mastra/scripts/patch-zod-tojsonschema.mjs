#!/usr/bin/env node
/**
 * Postinstall patch: make Zod 4's `toJSONSchema` tolerant of unrepresentable
 * types by default.
 *
 * Why this exists
 * ---------------
 * `@mastra/core@1.36.0` calls `z4.toJSONSchema(schema, { target: 'draft-7',
 * io: 'input' })` with NO `unrepresentable` option. Zod 4's default is
 * `'throw'`, so any Mastra-internal schema containing e.g. `z.date()` or an
 * optional wrapping a date causes Mastra to crash at server boot:
 *
 *     Error: [toJSONSchema]: Non-representable type encountered: optional
 *
 * Since ESM exports are read-only namespace bindings, we cannot
 * monkey-patch this at runtime. We patch the published source on disk.
 *
 * Which zod copies we patch
 * -------------------------
 * The Mastra CLI binary lives at `node_modules/mastra/` and resolves
 * `import('zod/v4/core')` from the repo root `node_modules/zod`. Our app's
 * runtime code may resolve to a nested copy in `apps/mastra/node_modules/zod`.
 * We patch every zod under any node_modules tree we can find from the repo
 * root, idempotently.
 *
 * Two file layouts to handle
 * --------------------------
 * Zod has shipped two distinct source layouts for the v4 JSON-schema code:
 *
 *   - Newer (e.g. zod@4.4.x): the public `toJSONSchema` lives in
 *     `v4/core/json-schema-processors.js`. Two `initializeContext(...)`
 *     call sites pass `{ ...params, processors: allProcessors }`. We
 *     inject `unrepresentable: 'any'` as a default into each.
 *
 *   - Older transitional (e.g. zod@3.25.x with v4 mini layout): the public
 *     `toJSONSchema` lives in `v4/core/to-json-schema.js` and constructs a
 *     `JSONSchemaGenerator` class. The default
 *     `this.unrepresentable = params?.unrepresentable ?? "throw"` is on
 *     one line. We flip it to `?? "any"`.
 *
 * Both patches are idempotent (marker comment) and only affect the default;
 * callers that explicitly pass `unrepresentable: 'throw'` still win.
 *
 * When to revisit
 * ---------------
 * Drop this patch the moment `@mastra/core` either upgrades to a Zod 4 that
 * doesn't throw on `unrepresentable` by default, or starts passing
 * `unrepresentable: 'any'` itself.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = '/* aso-patched-tojsonschema */'

const here = dirname(fileURLToPath(import.meta.url))
// scripts/ -> apps/mastra/ -> apps/ -> repo root.
const repoRoot = resolve(here, '..', '..', '..')

/**
 * Recursively find every `node_modules/zod/v4/core/` directory in the tree.
 * Returns a list of zod-v4-core absolute directory paths.
 */
function findZodCoreDirs(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.name === 'node_modules' && ent.isDirectory()) {
        let packages
        try {
          packages = readdirSync(full, { withFileTypes: true })
        } catch {
          continue
        }
        for (const pkg of packages) {
          if (!pkg.isDirectory()) continue
          if (pkg.name.startsWith('@')) {
            let scoped
            try {
              scoped = readdirSync(join(full, pkg.name), { withFileTypes: true })
            } catch {
              continue
            }
            for (const s of scoped) {
              if (s.isDirectory()) stack.push(join(full, pkg.name, s.name))
            }
            continue
          }
          if (pkg.name === 'zod') {
            const coreDir = join(full, 'zod', 'v4', 'core')
            try {
              statSync(coreDir)
              out.push(coreDir)
            } catch {
              // not v4
            }
          }
          stack.push(join(full, pkg.name))
        }
      } else if (
        ent.isDirectory() &&
        ent.name !== '.git' &&
        ent.name !== 'dist' &&
        ent.name !== 'build'
      ) {
        stack.push(full)
      }
    }
  }
  return out
}

/**
 * Patch the newer "json-schema-processors.{js,cjs}" layout:
 * inject `unrepresentable: 'any'` as a default into every
 * `initializeContext({ ...params, processors: <X> })` call site.
 *
 * Matches both shapes:
 *   - ESM: initializeContext({ ...params, processors: allProcessors })
 *   - CJS: (0, to_json_schema_js_1.initializeContext)({ ...params, processors: exports.allProcessors })
 */
function patchProcessorsFile(file) {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    return { file, status: 'missing' }
  }
  if (src.includes(MARKER)) return { file, status: 'already-patched' }
  const pattern =
    /(\(?[\w.\s,]*initializeContext\)?)\(\{ \.\.\.params, processors: ([\w.]+) \}\)/g
  const after = src.replace(
    pattern,
    `${MARKER} $1({ unrepresentable: 'any', ...params, processors: $2 })`,
  )
  if (after === src) return { file, status: 'pattern-not-found' }
  writeFileSync(file, after)
  return { file, status: 'patched-processors' }
}

/**
 * Patch the older "to-json-schema.js with JSONSchemaGenerator" layout:
 * flip the constructor default from "throw" to "any".
 */
function patchGeneratorFile(file) {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    return { file, status: 'missing' }
  }
  if (src.includes(MARKER)) return { file, status: 'already-patched' }
  // Match both `?? "throw"` and `?? 'throw'` for safety, and only the
  // unrepresentable default line.
  const pattern = /(this\.unrepresentable\s*=\s*params\?\.unrepresentable\s*\?\?\s*)["']throw["']/
  if (!pattern.test(src)) return { file, status: 'pattern-not-found' }
  const after =
    `${MARKER}\n` +
    src.replace(pattern, `$1'any' /* was 'throw' before aso patch */`)
  writeFileSync(file, after)
  return { file, status: 'patched-generator' }
}

/**
 * Same as patchGeneratorFile but operates on a CJS sibling, since older
 * zod ships both .js and .cjs that may be loaded depending on resolver.
 */
function patchAll(coreDir) {
  const results = []
  for (const ext of ['js', 'cjs']) {
    const processorsFile = join(coreDir, `json-schema-processors.${ext}`)
    const generatorFile = join(coreDir, `to-json-schema.${ext}`)
    try {
      statSync(processorsFile)
      results.push(patchProcessorsFile(processorsFile))
    } catch {
      // not this layout
    }
    try {
      statSync(generatorFile)
      // We only patch the generator file if the processors file doesn't exist
      // (older layout). In the newer layout to-json-schema.js holds `process`
      // helpers but not the public toJSONSchema entry; patching it is a no-op
      // since `unrepresentable: 'throw'` lives in initializeContext there too,
      // but patching is still safe (no-op if marker absent + pattern absent).
      results.push(patchGeneratorFile(generatorFile))
    } catch {
      // missing
    }
  }
  return results
}

const dirs = findZodCoreDirs(repoRoot)
if (dirs.length === 0) {
  console.warn('[patch-zod-tojsonschema] no zod v4 core dirs found under', repoRoot)
  process.exit(0)
}

let total = 0
for (const d of dirs) {
  const rel = d.replace(repoRoot + '/', '')
  const results = patchAll(d)
  for (const r of results) {
    const relFile = r.file.replace(repoRoot + '/', '')
    console.log(`[patch-zod-tojsonschema] ${r.status}: ${relFile}`)
    if (r.status === 'patched-processors' || r.status === 'patched-generator') total++
  }
}
console.log(`[patch-zod-tojsonschema] done. ${total} file(s) patched this run.`)
