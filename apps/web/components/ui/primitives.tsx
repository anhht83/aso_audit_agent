/**
 * Tiny owned UI primitives. No shadcn install step, no design-system dep.
 * Each export is a thin Tailwind-styled wrapper around a native element.
 */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }
>(function Button({ className, variant = 'primary', ...rest }, ref) {
  const styles = {
    primary:
      'bg-accent text-bg hover:bg-accent/90 disabled:bg-accentDim disabled:text-textDim',
    secondary:
      'bg-surface2 text-text border border-border hover:bg-surface2/70 disabled:opacity-60',
    ghost: 'bg-transparent text-textDim hover:text-text hover:bg-surface2/50',
  }[variant]
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed',
        styles,
        className,
      )}
      {...rest}
    />
  )
})

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('rounded-xl border border-border bg-surface p-4 shadow-sm', className)}
      {...rest}
    />
  )
}

export function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warn' | 'danger' }) {
  const t = {
    neutral: 'border-border text-textDim',
    success: 'border-success/40 text-success',
    warn: 'border-warn/40 text-warn',
    danger: 'border-danger/40 text-danger',
  }[tone]
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        t,
      )}
    >
      {children}
    </span>
  )
}
