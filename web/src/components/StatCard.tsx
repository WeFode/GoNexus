import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { IconTile, type Tone } from './IconTile'

interface StatCardProps {
  icon: ReactNode
  tone?: Tone
  label: string
  value: ReactNode
  hint?: ReactNode
  onClick?: () => void
}

export function StatCard({ icon, tone = 'neutral', label, value, hint, onClick }: StatCardProps) {
  const interactive = Boolean(onClick)

  return (
    <Card
      className={cn(
        'gap-0 py-0 transition-colors',
        interactive && 'hover:border-foreground/25 hover:bg-accent/40 cursor-pointer',
      )}
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick?.()
              }
            },
          }
        : {})}
    >
      <div className="flex items-start gap-3 p-4 sm:p-[18px]">
        <IconTile tone={tone}>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground text-[13px] leading-5">{label}</div>
          <div className="mt-0.5 text-2xl leading-8 font-semibold tracking-tight tabular-nums">{value}</div>
          {hint ? <div className="text-muted-foreground mt-0.5 truncate text-xs leading-5">{hint}</div> : null}
        </div>
      </div>
    </Card>
  )
}
