import { toJSONSchema } from 'zod/v4/core'
import { fetchAppMetadata } from './src/tools/fetch-app-metadata.ts'
import { fetchCompetitors } from './src/tools/fetch-competitors.ts'
import { asoAuditWorkflow } from './src/workflows/aso-audit-workflow.ts'

const tries: [string, unknown][] = [
  ['fetchAppMetadata.inputSchema', (fetchAppMetadata as any).inputSchema],
  ['fetchAppMetadata.outputSchema', (fetchAppMetadata as any).outputSchema],
  ['fetchCompetitors.inputSchema', (fetchCompetitors as any).inputSchema],
  ['fetchCompetitors.outputSchema', (fetchCompetitors as any).outputSchema],
  ['workflow.inputSchema', (asoAuditWorkflow as any).inputSchema],
  ['workflow.outputSchema', (asoAuditWorkflow as any).outputSchema],
]

const wf = asoAuditWorkflow as any
for (const stepKey of Object.keys(wf.steps ?? {})) {
  const step = wf.steps[stepKey]
  for (const field of ['inputSchema', 'outputSchema', 'suspendSchema', 'resumeSchema']) {
    if (step?.[field]) tries.push([`step[${stepKey}].${field}`, step[field]])
  }
}
for (const stepKey of Object.keys(wf.stepDefs ?? {})) {
  const step = wf.stepDefs[stepKey]
  for (const field of ['inputSchema', 'outputSchema', 'suspendSchema', 'resumeSchema']) {
    if (step?.[field]) tries.push([`stepDefs[${stepKey}].${field}`, step[field]])
  }
}

for (const io of ['input', 'output'] as const) {
  console.log(`---- io: ${io} ----`)
  for (const [name, s] of tries) {
    try {
      toJSONSchema(s as any, { target: 'draft-7', io })
      // console.log('  ok   ', name)
    } catch (e: any) {
      console.log('  FAIL ', name, '->', e.message)
    }
  }
}
console.log('Done')
