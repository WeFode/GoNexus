import type { ReactNode } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, OctagonAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const toneStyles: Record<AlertTone, { wrap: string; icon: string; defaultIcon: ReactNode }> = {
  info: { wrap: 'border-info/30 bg-info/[0.06]', icon: 'text-info', defaultIcon: <InfoIcon /> },
  success: { wrap: 'border-success/30 bg-success/[0.06]', icon: 'text-success', defaultIcon: <CheckCircle2Icon /> },
  warning: { wrap: 'border-warning/40 bg-warning/[0.08]', icon: 'text-warning', defaultIcon: <AlertTriangleIcon /> },
  danger: {
    wrap: 'border-destructive/30 bg-destructive/[0.06]',
    icon: 'text-destructive',
    defaultIcon: <OctagonAlertIcon />,
  },
  neutral: { wrap: 'bg-muted/50 border-border', icon: 'text-muted-foreground', defaultIcon: <InfoIcon /> },
}

interface InlineAlertProps {
  tone?: AlertTone
  icon?: ReactNode | null
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}

/** 带语义色的行内提示块，替代 antd Alert：标题、说明、右侧操作三段式 */
export function InlineAlert({
  tone = 'info',
  icon,
  title,
  description,
  children,
  action,
  className,
}: InlineAlertProps) {
  const styles = toneStyles[tone]

  return (
    <div
      role="alert"
      className={cn('flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm', styles.wrap, className)}
    >
      {icon === null ? null : (
        <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', styles.icon)}>{icon ?? styles.defaultIcon}</span>
      )}
      <div className="min-w-0 flex-1">
        {title ? <div className="leading-5 font-medium">{title}</div> : null}
        {description ? <div className="text-muted-foreground mt-0.5 text-[13px] leading-5">{description}</div> : null}
        {children}
      </div>
      {action ? <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 self-center">{action}</div> : null}
    </div>
  )
}
