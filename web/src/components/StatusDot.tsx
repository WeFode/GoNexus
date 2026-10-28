import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatusTone = 'ok' | 'warn' | 'bad' | 'idle' | 'info'

const toneClasses: Record<StatusTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  idle: 'bg-muted-foreground/50',
  info: 'bg-info',
}

interface StatusDotProps {
  tone: StatusTone
  /** 状态点旁边的文字；只给读屏用，视觉上由调用方自己排版 */
  label?: string
  pulse?: boolean
  className?: string
}

export function StatusDot({ tone, label, pulse, className }: StatusDotProps) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', toneClasses[tone], className)}
      style={pulse ? { animation: 'cc-live-pulse 2s ease-out infinite' } : undefined}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

interface StatusLineProps {
  tone: StatusTone
  children: ReactNode
  pulse?: boolean
  className?: string
}

/** 状态点 + 文字的固定组合，避免出现「只有一个颜色圆点」的不可读状态 */
export function StatusLine({ tone, children, pulse, className }: StatusLineProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  )
}
