'use client'

import type { ProgressStatus, ProgressStep } from '@aso/shared'

const STEP_LABELS: Record<ProgressStep, string> = {
  resolveListing: 'Fetching app metadata',
  fetchCompetitors: 'Scraping competitors',
  scoring: 'Scoring dimensions',
}

interface Props {
  steps: readonly ProgressStep[]
  progress: Partial<Record<ProgressStep, ProgressStatus>>
  /** When true, the strip is hidden (audit complete). */
  done: boolean
}

export function ProgressStrip({ steps, progress, done }: Props) {
  if (done) return null
  const any = Object.keys(progress).length > 0
  if (!any) return null

  return (
    <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
      <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
        {steps.map(step => {
          const status = progress[step]
          return (
            <li key={step} className="flex items-center gap-2 text-sm">
              <StatusDot status={status} />
              <span className={status === 'completed' ? 'text-textDim line-through' : 'text-text'}>
                {STEP_LABELS[step]}
              </span>
              {status === 'failed' && (
                <span className="text-xs text-danger">(failed)</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StatusDot({ status }: { status?: ProgressStatus }) {
  if (status === 'completed') {
    return (
      <span aria-label="completed" className="grid h-4 w-4 place-items-center rounded-full bg-success/20 text-success">
        ✓
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span aria-label="failed" className="grid h-4 w-4 place-items-center rounded-full bg-danger/20 text-danger">
        ×
      </span>
    )
  }
  if (status === 'started') {
    return (
      <span aria-label="in progress" className="relative inline-block h-4 w-4">
        <span className="absolute inset-0 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </span>
    )
  }
  return <span className="inline-block h-4 w-4 rounded-full bg-surface2" aria-hidden />
}
