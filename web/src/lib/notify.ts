import { toast } from 'sonner'

/** 后端 ApiError 的 message 就是给用户看的中文原文，优先透传 */
export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

export function notifyError(error: unknown, fallback?: string) {
  toast.error(errorMessage(error, fallback))
}
