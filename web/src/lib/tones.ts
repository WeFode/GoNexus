import type { Tone } from '@/components/IconTile'

/** 发布任务状态 → 语义色，概览页与发布页共用一份映射 */
export function jobTone(status: string): Tone {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'waiting') return 'warning'
  return 'info'
}
