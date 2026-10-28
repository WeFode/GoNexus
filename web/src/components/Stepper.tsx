import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepItem {
  title: string
  description?: string
  icon?: ReactNode
}

interface StepperProps {
  steps: StepItem[]
  current: number
  className?: string
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn('flex items-start gap-2 sm:gap-3', className)}>
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        return (
          <li key={step.title} className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium [&_svg]:size-3.5',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-foreground text-foreground',
                !done && !active && 'border-border text-muted-foreground',
              )}
            >
              {done ? <CheckIcon /> : (step.icon ?? index + 1)}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  'block truncate text-[13px] leading-6',
                  active ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {step.title}
              </span>
              {step.description ? (
                <span className="text-muted-foreground hidden truncate text-xs sm:block">{step.description}</span>
              ) : null}
            </span>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn('mt-3 hidden h-px flex-1 sm:block', done ? 'bg-foreground/40' : 'bg-border')}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
