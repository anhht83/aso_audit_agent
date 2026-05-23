'use client'

import { useCallback, useRef, useState } from 'react'
import {
  type ChatMessage,
  type ChatRequest,
  type ProgressStatus,
  type ProgressStep,
  type StreamEvent,
  streamEventSchema,
} from '@aso/shared'
import { readEventStream } from './event-stream'

export interface UserTurn {
  id: string
  role: 'user'
  text: string
}

export type AssistantTurn = ChatMessage & { id: string }

export type ChatTurn = UserTurn | AssistantTurn

export type ProgressMap = Partial<Record<ProgressStep, ProgressStatus>>

interface ChatState {
  turns: ChatTurn[]
  progress: ProgressMap
  isLoading: boolean
  /** Set when the agent emits a confirmation message; clears on submit. */
  pendingResumeToken: string | null
}

let _id = 0
const nextId = () => `t-${++_id}`

const PROGRESS_STEPS: readonly ProgressStep[] = [
  'resolveListing',
  'fetchCompetitors',
  'scoring',
]

export function useAgentChat() {
  const [state, setState] = useState<ChatState>({
    turns: [],
    progress: {},
    isLoading: false,
    pendingResumeToken: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const appendTurn = (turn: ChatTurn) =>
    setState(s => ({ ...s, turns: [...s.turns, turn] }))

  /**
   * Send a request to the agent and consume the NDJSON event stream.
   * Internal helper used by both `send` (start) and `respondConfirmation` (resume).
   */
  const runRequest = useCallback(async (req: ChatRequest, optimisticUser?: UserTurn) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setState(s => ({
      ...s,
      turns: optimisticUser ? [...s.turns, optimisticUser] : s.turns,
      progress: req.kind === 'start' ? {} : s.progress,
      isLoading: true,
      pendingResumeToken: null,
    }))

    let response: Response
    try {
      response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ac.signal,
      })
    } catch (e) {
      appendTurn({
        id: nextId(),
        type: 'message',
        kind: 'error',
        text: `Could not reach the audit service: ${(e as Error).message}`,
      })
      setState(s => ({ ...s, isLoading: false }))
      return
    }

    if (!response.ok) {
      let body = ''
      try {
        body = await response.text()
      } catch {
        // ignore
      }
      appendTurn({
        id: nextId(),
        type: 'message',
        kind: 'error',
        text: `Service error ${response.status}: ${body || response.statusText}`,
      })
      setState(s => ({ ...s, isLoading: false }))
      return
    }

    try {
      for await (const raw of readEventStream(response)) {
        const parsed = streamEventSchema.safeParse(raw)
        if (!parsed.success) {
          // Unknown event shape - log and continue rather than fail the stream.
          // eslint-disable-next-line no-console
          console.warn('Dropping unknown stream event', raw)
          continue
        }
        applyEvent(parsed.data)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        appendTurn({
          id: nextId(),
          type: 'message',
          kind: 'error',
          text: `Stream ended unexpectedly: ${(e as Error).message}`,
        })
      }
    } finally {
      setState(s => ({ ...s, isLoading: false }))
    }
  }, [])

  const applyEvent = (event: StreamEvent) => {
    if (event.type === 'progress') {
      setState(s => ({
        ...s,
        progress: { ...s.progress, [event.step]: event.status },
      }))
      return
    }

    // event.type === 'message'
    if (event.kind === 'confirmation') {
      appendTurn({ id: nextId(), ...event })
      setState(s => ({ ...s, pendingResumeToken: event.resumeToken }))
      return
    }
    appendTurn({ id: nextId(), ...event })
  }

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const userTurn: UserTurn = { id: nextId(), role: 'user', text: trimmed }
      void runRequest({ kind: 'start', text: trimmed }, userTurn)
    },
    [runRequest],
  )

  const respondConfirmation = useCallback(
    (confirmed: boolean) => {
      const token = state.pendingResumeToken
      if (!token) return
      const userTurn: UserTurn = {
        id: nextId(),
        role: 'user',
        text: confirmed ? 'Yes, audit this app.' : 'No, that\'s the wrong app.',
      }
      void runRequest({ kind: 'resume', resumeToken: token, confirmed }, userTurn)
    },
    [runRequest, state.pendingResumeToken],
  )

  /**
   * Interpret a plain text response from the user during a pending confirmation.
   * Lets the user type "yes" / "no" instead of clicking, per spec.
   */
  const sendWithConfirmationFallback = useCallback(
    (text: string) => {
      if (!state.pendingResumeToken) {
        send(text)
        return
      }
      const t = text.trim().toLowerCase()
      const yes = ['yes', 'y', 'yep', 'yeah', 'audit', 'confirm', 'go', 'do it']
      const no = ['no', 'n', 'nope', 'wrong', "that's wrong", 'cancel']
      if (yes.some(w => t === w || t.startsWith(w + ' '))) {
        respondConfirmation(true)
        return
      }
      if (no.some(w => t === w || t.startsWith(w + ' '))) {
        respondConfirmation(false)
        return
      }
      // Anything else - treat as a new audit request.
      send(text)
    },
    [respondConfirmation, send, state.pendingResumeToken],
  )

  return {
    turns: state.turns,
    progress: state.progress,
    isLoading: state.isLoading,
    pendingResumeToken: state.pendingResumeToken,
    send: sendWithConfirmationFallback,
    respondConfirmation,
    progressSteps: PROGRESS_STEPS,
  }
}
