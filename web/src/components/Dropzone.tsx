import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UploadCloudIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
  title?: string
  hint?: ReactNode
  className?: string
}

/** 原生拖拽上传区，替代 antd Upload.Dragger：不接管请求，只把选中的文件交回调用方 */
export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  disabled,
  title = '点击或拖拽文件到此处',
  hint,
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(false)
        emit(event.dataTransfer.files)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-6 py-7 text-center transition-colors outline-none',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        dragging ? 'border-foreground/50 bg-muted/70' : 'border-border hover:border-foreground/30 hover:bg-muted/40',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          emit(event.target.files)
          // 允许再次选择同一个文件
          event.target.value = ''
        }}
      />
      <UploadCloudIcon className={cn('size-6', dragging ? 'text-foreground' : 'text-muted-foreground')} />
      <span className="text-sm font-medium">{title}</span>
      {hint ? <span className="text-muted-foreground max-w-md text-xs leading-5">{hint}</span> : null}
    </div>
  )
}
