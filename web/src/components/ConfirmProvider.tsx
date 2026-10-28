import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notifyError } from '@/lib/notify'

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  /** 需要填写原因时配置，原因会回传给 onConfirm（通常写入审计） */
  reason?: { label?: string; placeholder?: string; required?: boolean }
  /** 返回 Promise 时对话框保持打开并显示 loading，失败则自动 toast 并留在原地 */
  onConfirm?: (reason: string) => Promise<void> | void
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingState {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null)
  const pendingRef = useRef<PendingState | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [busy, setBusy] = useState(false)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const state = { options, resolve }
        pendingRef.current = state
        setReason('')
        setReasonError('')
        setBusy(false)
        setPending(state)
      }),
    [],
  )

  const finish = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok)
    pendingRef.current = null
    setPending(null)
    setBusy(false)
  }, [])

  const onConfirmClick = async () => {
    if (!pending) return
    const { options } = pending
    const trimmed = reason.trim()
    if (options.reason?.required && !trimmed) {
      setReasonError('请填写原因，会写入审计历史')
      return
    }
    if (!options.onConfirm) {
      finish(true)
      return
    }
    setBusy(true)
    try {
      await options.onConfirm(trimmed)
      finish(true)
    } catch (error) {
      notifyError(error)
      setBusy(false)
    }
  }

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) finish(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.options.title ?? '确认操作'}</AlertDialogTitle>
            {pending?.options.description ? (
              <AlertDialogDescription>{pending.options.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>

          {pending?.options.reason ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-reason">{pending.options.reason.label ?? '原因'}</Label>
              <Input
                id="confirm-reason"
                autoFocus
                value={reason}
                placeholder={pending.options.reason.placeholder}
                aria-invalid={Boolean(reasonError)}
                onChange={(event) => {
                  setReason(event.target.value)
                  if (reasonError) setReasonError('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void onConfirmClick()
                  }
                }}
              />
              {reasonError ? <p className="text-destructive text-xs">{reasonError}</p> : null}
            </div>
          ) : null}

          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => finish(false)}>
              {pending?.options.cancelText ?? '取消'}
            </Button>
            <Button
              variant={pending?.options.destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void onConfirmClick()}
            >
              {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {pending?.options.confirmText ?? '确认'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm 必须在 ConfirmProvider 内使用')
  return ctx
}
