import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DefinitionItem {
  label: ReactNode
  value: ReactNode
}

interface DefinitionListProps {
  items: DefinitionItem[]
  columns?: 2 | 3 | 4
  className?: string
}

const columnClasses: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
}

/** 键值对网格，替代 antd Descriptions */
export function DefinitionList({ items, columns = 3, className }: DefinitionListProps) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columnClasses[columns], className)}>
      {items.map((item, index) => (
        <div key={typeof item.label === 'string' ? item.label : index} className="min-w-0">
          <dt className="text-muted-foreground text-xs leading-5">{item.label}</dt>
          <dd className="mt-0.5 text-sm leading-5">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
