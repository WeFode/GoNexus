import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface PanelProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  footer?: ReactNode
  loading?: boolean
}

/** 紧凑面板：52px 标题栏 + 20px 内边距，全站带标题的卡片都用它 */
export function Panel({ title, description, actions, children, className, bodyClassName, footer, loading }: PanelProps) {
  return (
    <div className={cn('bg-card text-card-foreground flex flex-col rounded-lg border', className)}>
      {title || actions ? (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            {description ? <div className="text-muted-foreground mt-0.5 text-xs">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn('min-h-0 flex-1 px-4 py-4 sm:px-5', bodyClassName)}>
        {loading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          children
        )}
      </div>

      {footer ? <div className="shrink-0 border-t px-4 py-3 sm:px-5">{footer}</div> : null}
    </div>
  )
}
