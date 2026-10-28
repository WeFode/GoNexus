import type { ComponentProps } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type TextareaProps = ComponentProps<typeof Textarea>

/** 编辑态：等宽字体 + 自适应高度，语法校验交给服务端 */
export function YamlEditor({ className, ...props }: TextareaProps) {
  return (
    <Textarea
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      className={cn(
        'field-sizing-content max-h-[560px] min-h-[168px] resize-y font-mono text-[12.5px] leading-5',
        className,
      )}
      {...props}
    />
  )
}

interface YamlViewProps {
  value: string
  className?: string
  maxHeight?: number
}

/** 只读态：用 pre 渲染，滚动与换行行为比 textarea 更可控 */
export function YamlView({ value, className, maxHeight = 260 }: YamlViewProps) {
  return (
    <pre
      className={cn(
        'bg-muted/40 overflow-auto rounded-md border px-3 py-2.5 font-mono text-[12.5px] leading-5 whitespace-pre-wrap break-words',
        className,
      )}
      style={{ maxHeight }}
    >
      {value}
    </pre>
  )
}
