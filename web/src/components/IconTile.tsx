import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  violet: 'bg-chart-5/10 text-chart-5',
}

interface IconTileProps extends ComponentProps<'span'> {
  tone?: Tone
  size?: 'sm' | 'md'
}

export function IconTile({ tone = 'neutral', size = 'md', className, children, ...props }: IconTileProps) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
        size === 'md' ? 'size-9' : 'size-7 [&_svg]:size-3.5',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
