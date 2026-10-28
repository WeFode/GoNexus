import { SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

export function SearchInput({ value, onChange, placeholder = '搜索', className, autoFocus }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="pr-8 pl-8"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            onChange('')
          }
        }}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="清空搜索"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => onChange('')}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}
