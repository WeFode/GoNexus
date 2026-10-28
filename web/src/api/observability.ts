import { getToken } from '../auth/session'
import { request } from './client'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | string
export type LogSource = 'server' | 'access' | 'agent' | 'deploy' | 'config' | 'auth' | string

export interface LogItem {
  id: number
  ts: number
  time: string
  level: LogLevel
  source: LogSource
  service?: string
  message: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  user?: string
  ip?: string
  nodeId?: string
  jobId?: number
  action?: string
}

export interface StatusStat {
  key: string
  count: number
}

export interface RouteStat {
  method: string
  route: string
  count: number
  errors: number
  avgMs: number
}

export interface MinutePoint {
  minute: string
  total: number
  errors: number
  avgMs: number
  p95Ms: number
}

export interface BufferStat {
  capacity: number
  size: number
  total: number
  clients: number
}

export interface RuntimeStat {
  goVersion: string
  numCPU: number
  goroutines: number
  heapAllocMB: number
  heapInuseMB: number
  sysMB: number
  numGC: number
  startedAt: string
  uptimeSec: number
}

export interface OverviewRes {
  requestTotal: number
  inFlight: number
  errorRate: number
  avgMs: number
  p95Ms: number
  rps: number
  statuses: StatusStat[]
  routes: RouteStat[]
  minutes: MinutePoint[]
  buffer: BufferStat
  runtime: RuntimeStat
  generatedAt: string
}

export interface ServiceItem {
  name: string
  count: number
  lastTs: number
  seenAt: number
}

export interface LogsRes {
  items: LogItem[]
  lastId: number
  sources: string[]
  services: ServiceItem[]
}

export interface ServicesRes {
  items: ServiceItem[]
}

export function getObservabilityOverview() {
  return request<OverviewRes>('/api/v1/observability/overview')
}

export function listLogs(limit = 300, service = '') {
  const q = new URLSearchParams({ limit: String(limit) })
  if (service) q.set('service', service)
  return request<LogsRes>(`/api/v1/observability/logs?${q.toString()}`)
}

export function getObservabilityServices() {
  return request<ServicesRes>('/api/v1/observability/services')
}

/** EventSource 不能自定义请求头，token 走查询参数；lastId 用于首连补齐。 */
export function logStreamUrl(lastId: number) {
  const q = new URLSearchParams({ token: getToken(), lastId: String(lastId) })
  return `/api/v1/observability/logs/stream?${q.toString()}`
}
