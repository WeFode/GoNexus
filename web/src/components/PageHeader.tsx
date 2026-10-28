import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  extra?: ReactNode
}

export function PageHeader({ title, description, extra }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-[13px] leading-5">{description}</p> : null}
      </div>
      {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
    </div>
  )
}
