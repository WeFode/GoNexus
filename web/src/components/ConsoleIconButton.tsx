import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { consoleIconButtonClass } from '../lib/console'

interface Props {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

/** 深色控制台里的图标按钮：默认 ghost 在黑底上不可见，这里统一覆盖配色 */
export function ConsoleIconButton({ label, disabled, onClick, children }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={consoleIconButtonClass}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
