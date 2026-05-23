'use client'

import type {
  AuditReport,
  CompetitorSummary,
  Dimension,
  Recommendation,
} from '@aso/shared'
import { Bar, Card, Pill } from './ui/primitives'

interface Props {
  report: AuditReport
}

export function AuditReportView({ report }: Props) {
  const observable = report.dimensions.filter(d => d.visibility === 'observable')
  const hidden = report.dimensions.filter(d => d.visibility !== 'observable')

  return (
    <div className="flex flex-col gap-4">
      <Header report={report} />
      <ScoreCard observable={observable} hidden={hidden} />
      <RecommendationSection title="Quick Wins" hint="Implementable today" recs={report.quickWins} />
      <RecommendationSection
        title="High-Impact Changes"
        hint="More effort, significant impact"
        recs={report.highImpact}
      />
      <RecommendationSection title="Strategic" hint="Longer-term" recs={report.strategic} />
      <CompetitorComparisonView comparison={report.competitorComparison} />
    </div>
  )
}

function Header({ report }: { report: AuditReport }) {
  const { app, overallScore } = report
  return (
    <Card className="flex items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={app.iconUrl}
        alt=""
        className="h-14 w-14 flex-shrink-0 rounded-2xl border border-border object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{app.name}</div>
        <div className="truncate text-sm text-textDim">
          {app.developer} · {app.category} · {app.country.toUpperCase()}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs uppercase tracking-wide text-textDim">ASO Score</div>
        <div className="text-3xl font-semibold tabular-nums">
          {overallScore.toFixed(1)}
          <span className="text-base text-textDim">/100</span>
        </div>
      </div>
    </Card>
  )
}

function ScoreCard({ observable, hidden }: { observable: Dimension[]; hidden: Dimension[] }) {
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textDim">
        Score by dimension
      </h3>
      <ul className="flex flex-col gap-3">
        {observable.map(d => (
          <DimensionRow key={d.name} dimension={d} />
        ))}
      </ul>
      {hidden.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-textDim">
            Not visible from public listing
          </h4>
          <ul className="flex flex-col gap-2">
            {hidden.map(d => (
              <li key={d.name} className="rounded-md bg-surface2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{d.name}</span>
                  <Pill tone="warn">Requires App Store Connect</Pill>
                  <span className="ml-auto text-xs text-textDim">{d.weight}% weight (excluded)</span>
                </div>
                <p className="mt-1 text-xs text-textDim">{d.reasoning}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function DimensionRow({ dimension }: { dimension: Dimension }) {
  const score = dimension.score ?? 0
  return (
    <li>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-sm font-medium">{dimension.name}</span>
        <span className="text-xs text-textDim">{dimension.weight}%</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {dimension.score === null ? '—' : `${score.toFixed(1)} / 10`}
        </span>
      </div>
      <Bar value={score * 10} />
      <p className="mt-1 text-xs leading-relaxed text-textDim">
        <span className="text-text/80">Evidence:</span> {dimension.evidence}{' '}
        <span className="text-text/80">Reasoning:</span> {dimension.reasoning}
      </p>
    </li>
  )
}

function RecommendationSection({
  title,
  hint,
  recs,
}: {
  title: string
  hint: string
  recs: Recommendation[]
}) {
  if (recs.length === 0) return null
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-textDim">{title}</h3>
        <span className="text-xs text-textDim">{hint}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {recs.map((r, i) => (
          <RecommendationItem key={`${title}-${i}`} rec={r} />
        ))}
      </ul>
    </Card>
  )
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  return (
    <li className="rounded-lg border border-border bg-surface2 p-3">
      <div className="font-medium">{rec.title}</div>
      <p className="mt-1 text-xs text-textDim">
        <span className="text-text/80">Evidence:</span> {rec.evidence}
      </p>
      <p className="mt-1 text-xs text-textDim">{rec.rationale}</p>
      {(rec.before || rec.after) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {rec.before !== null && (
            <div className="rounded-md border border-danger/30 bg-danger/5 p-2 text-xs">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
                Before
              </div>
              <div className="whitespace-pre-wrap">{rec.before}</div>
            </div>
          )}
          {rec.after !== null && (
            <div className="rounded-md border border-success/30 bg-success/5 p-2 text-xs">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-success">
                After
              </div>
              <div className="whitespace-pre-wrap">{rec.after}</div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function CompetitorComparisonView({
  comparison,
}: {
  comparison: AuditReport['competitorComparison']
}) {
  const rows: CompetitorSummary[] = [comparison.subject, ...comparison.competitors]
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textDim">
        Competitor comparison
      </h3>
      {comparison.competitors.length === 0 ? (
        <p className="text-sm text-textDim">{comparison.summary}</p>
      ) : (
        <>
          <p className="mb-3 text-sm">{comparison.summary}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-textDim">
                  <th className="py-2 pr-3 font-medium">App</th>
                  <th className="py-2 pr-3 font-medium">Subtitle</th>
                  <th className="py-2 pr-3 font-medium">Rating</th>
                  <th className="py-2 pr-3 font-medium">Screens</th>
                  <th className="py-2 pr-3 font-medium">Video</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.appId}
                    className={
                      i === 0
                        ? 'border-b border-border bg-accent/5 font-medium'
                        : 'border-b border-border/60'
                    }
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-textDim">{row.developer}</div>
                    </td>
                    <td className="py-2 pr-3 text-textDim">{row.subtitle ?? '—'}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {row.averageRating !== null ? (
                        <>
                          {row.averageRating.toFixed(1)}★
                          {row.ratingCount !== null && (
                            <span className="text-xs text-textDim">
                              {' '}
                              ({formatCount(row.ratingCount)})
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{row.screenshotCount}</td>
                    <td className="py-2 pr-3">{row.hasPreviewVideo ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}
