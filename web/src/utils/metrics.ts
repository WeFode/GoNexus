export function formatGB(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 已上报值用 -1 作为哨兵，未上报时统一返回 null 交给 UI 兜底 */
export function pctOfReported(value: number | undefined): number | null {
  return value != null && value >= 0 ? Math.round(value) : null
}

export function pctOfUsed(used: number | undefined, total: number): number | null {
  if (!total || used == null || used < 0) return null
  return Math.round((used / total) * 100)
}
