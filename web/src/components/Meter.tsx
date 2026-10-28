import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 70% 起预警、85% 起告警，和节点卡片、推荐表的判定保持一致 */
export function percentToneClass(percent: number | null): string {
  if (percent == null) return 'bg-muted-foreground/30'
  if (percent >= 85) return 'bg-destructive'
  if (percent >= 70) return 'bg-warning'
  return 'bg-success'
}

interface MeterProps {
  caption: ReactNode
  percent: number | null
  minWidth?: number
  className?: string
}

export function Meter({ caption, percent, minWidth = 132, className }: MeterProps) {
  const clamped = Math.min(100, Math.max(0, percent ?? 0))

  return (
    <div className={cn('min-w-0', className)} style={{ minWidth }}>
      <div className="text-muted-foreground mb-1 truncate text-xs leading-4">{caption}</div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="bg-muted h-1.5 overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', percentToneClass(percent))}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
