import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Tone } from './IconTile'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  violet: 'bg-chart-5/10 text-chart-5',
}

interface ToneBadgeProps {
  tone?: Tone
  children: ReactNode
  className?: string
}

/** 带语义色的标签：部署状态、版本动作、节点能力都用它，避免散落的十六进制色 */
export function ToneBadge({ tone = 'neutral', children, className }: ToneBadgeProps) {
  return (
    <Badge variant="secondary" className={cn('border-transparent', toneClasses[tone], className)}>
      {children}
    </Badge>
  )
}
