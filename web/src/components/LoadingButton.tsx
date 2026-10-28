import type { ComponentProps, ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ButtonProps = ComponentProps<typeof Button>

interface LoadingButtonProps extends ButtonProps {
  loading?: boolean
  children?: ReactNode
}

/** 异步按钮：loading 期间自动禁用，避免重复提交 */
export function LoadingButton({ loading, disabled, children, ...props }: LoadingButtonProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading ? <Loader2Icon className="size-4 animate-spin" /> : null}
      {children}
    </Button>
  )
}
