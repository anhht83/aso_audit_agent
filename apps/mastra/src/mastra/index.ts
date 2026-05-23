/**
 * Mastra service entry point.
 *
 * This is the file `mastra dev` and `mastra build` look for by convention
 * (src/mastra/index.ts at the project root, which here is apps/mastra).
 *
 * Everything else lives one directory up under src/ so the layout reads like
 * a service rather than a Mastra-specific magic folder.
 *
 * Verified against @mastra/core@1.36.0:
 *   - Workspace accepts { filesystem: LocalFilesystem, skills: string[] }.
 *   - `skills` entries are paths relative to the filesystem basePath.
 *   - Skill discovery walks each path for SKILL.md files.
 *
 * Path resolution: we resolve basePath relative to THIS file's URL so the
 * service still finds its skills regardless of CWD (`mastra dev` from the
 * package root vs. workspace root).
 */
// Touch env early to fail fast on missing config before Mastra boots.
import '../env.ts'

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Mastra } from '@mastra/core'
import { LocalFilesystem, Workspace } from '@mastra/core/workspace'
import { LibSQLStore } from '@mastra/libsql'
import { asoAuditAgent } from '../agents/aso-audit'
import { asoAuditWorkflow } from '../workflows/aso-audit-workflow'
import { chatRoute } from '../server/chat-route'
import { env } from '../env'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// apps/mastra/src is the parent of apps/mastra/src/mastra/.
const SRC_DIR = resolve(__dirname, '..')
// apps/mastra/src/mastra/index.ts -> apps/mastra/ is two `..` up from this file.
const PACKAGE_DIR = resolve(__dirname, '..', '..')

/**
 * Workspace exposing the three vendored skills:
 *   - aso-audit (primary rubric)
 *   - metadata-optimization (loaded on demand for title/subtitle/description/promo recs)
 *   - screenshot-optimization (loaded on demand for screenshot recs)
 *
 * Assigning the workspace at the Mastra level means every agent on this
 * service gets the `skill`, `skill_read`, and `skill_search` tools and can
 * discover all three skills automatically. We deliberately do NOT enable a
 * sandbox or expose the rest of the filesystem - the audit agent only needs
 * to read skill content, not execute commands or write files.
 */
const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: SRC_DIR }),
  skills: ['skills'],
})

/**
 * SQLite-backed storage so suspended workflow snapshots survive `mastra dev`
 * hot-restarts. Without this, every source-file edit between paste-URL and
 * click-confirm wipes the run and resume fails with:
 *   "No snapshot found for this workflow run: aso-audit-workflow <runId>".
 *
 * The DB file lives under apps/mastra/ so it's scoped to this service. It's
 * gitignored; nothing else in the codebase reads it directly.
 */
const storage = new LibSQLStore({
  id: 'aso-audit',
  url: `file:${resolve(PACKAGE_DIR, 'mastra.db')}`,
})

export const mastra = new Mastra({
  workspace,
  storage,
  agents: { asoAuditAgent },
  workflows: { asoAuditWorkflow },
  server: {
    port: env.MASTRA_PORT,
    apiRoutes: [chatRoute],
  },
})
