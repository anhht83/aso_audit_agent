'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentChat, type ChatTurn } from '@/lib/use-agent-chat'
import { AuditReportView } from '@/components/AuditReport'
import { ConfirmationCard } from '@/components/ConfirmationCard'
import { ProgressStrip } from '@/components/ProgressStrip'
import { Button, Card } from '@/components/ui/primitives'

export default function HomePage() {
  const {
    turns,
    progress,
    isLoading,
    pendingResumeToken,
    send,
    respondConfirmation,
    progressSteps,
  } = useAgentChat()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new turns / progress.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, progress])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    send(input)
    setInput('')
  }

  const auditDone = useMemo(
    () => turns.some(t => 'kind' in t && t.kind === 'audit-report'),
    [turns],
  )

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-4 py-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">ASO Audit</h1>
        <span className="text-xs text-textDim">
          Paste an Apple App Store URL to begin.
        </span>
      </header>

      <div
        ref={scrollRef}
        className="chat-scroll flex-1 space-y-4 overflow-y-auto pr-2"
      >
        {turns.length === 0 && <EmptyState />}
        {turns.map(turn => (
          <Turn
            key={turn.id}
            turn={turn}
            isLatest={turn.id === turns[turns.length - 1]?.id}
            isLoading={isLoading}
            hasPendingConfirmation={pendingResumeToken !== null}
            onConfirm={() => respondConfirmation(true)}
            onReject={() => respondConfirmation(false)}
          />
        ))}
        <ProgressStrip steps={progressSteps} progress={progress} done={auditDone} />
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <input
          type="text"
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="https://apps.apple.com/us/app/..."
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-textDim focus:border-accent"
          disabled={isLoading && !pendingResumeToken}
          aria-label="Message"
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? 'Working…' : 'Send'}
        </Button>
      </form>
    </main>
  )
}

function EmptyState() {
  return (
    <Card className="text-sm leading-relaxed text-textDim">
      <p className="text-text">Paste an Apple App Store URL to start an audit.</p>
      <p className="mt-2">
        Try{' '}
        <code className="rounded bg-surface2 px-1 text-xs">
          https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580
        </code>{' '}
        or any other published App Store URL.
      </p>
      <p className="mt-2">
        I will fetch the listing, confirm the app with you, then score it on the ten ASO
        dimensions and produce a prioritized action plan.
      </p>
    </Card>
  )
}

interface TurnProps {
  turn: ChatTurn
  isLatest: boolean
  isLoading: boolean
  hasPendingConfirmation: boolean
  onConfirm: () => void
  onReject: () => void
}

function Turn({ turn, isLatest, isLoading, hasPendingConfirmation, onConfirm, onReject }: TurnProps) {
  if ('role' in turn && turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-bg">
          {turn.text}
        </div>
      </div>
    )
  }

  // Assistant turns are ChatMessage variants.
  if ('kind' in turn) {
    if (turn.kind === 'text') {
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-surface px-3 py-2 text-sm">
            {turn.text}
          </div>
        </div>
      )
    }
    if (turn.kind === 'confirmation') {
      // Only the latest confirmation is actionable; older ones render disabled.
      const actionable = isLatest && hasPendingConfirmation
      return (
        <ConfirmationCard
          listing={turn.listing}
          onConfirm={onConfirm}
          onReject={onReject}
          disabled={!actionable || isLoading}
        />
      )
    }
    if (turn.kind === 'audit-report') {
      return <AuditReportView report={turn.report} />
    }
    if (turn.kind === 'error') {
      return (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {turn.text}
        </div>
      )
    }
  }

  return null
}
