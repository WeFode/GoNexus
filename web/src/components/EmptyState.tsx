import type { ReactNode } from 'react'
import { InboxIcon } from 'lucide-react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, hint, icon, action, className }: EmptyStateProps) {
  return (
    <Empty className={cn('border-0 p-6 whitespace-normal sm:p-8', className)}>
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon">{icon ?? <InboxIcon />}</EmptyMedia>
        <EmptyTitle className="text-sm font-medium">{title}</EmptyTitle>
        {hint ? <EmptyDescription className="text-xs leading-5">{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent className="max-w-none items-center gap-0">{action}</EmptyContent> : null}
    </Empty>
  )
}
