import { request } from './client'

export interface ConfigItem {
  key: string
  fullKey: string
  content: string
  revision: number
}

export interface HealthRes {
  status: string
  etcd: string
}

export interface PreviewRes {
  name: string
  content: string
}

export interface SeedRes {
  written: number
}

export interface AuditMeta {
  operator?: string
  remark?: string
}

export interface HistoryItem {
  id: number
  configKey: string
  version: number
  content: string
  actionType: string
  operator: string
  remark: string
  createdAt: string
}

function withAudit(extra: Record<string, unknown> = {}, meta?: AuditMeta) {
  return {
    ...extra,
    remark: meta?.remark || '',
  }
}

export function listShared() {
  return request<{ list: ConfigItem[] }>('/api/v1/configs/shared').then((d) => d.list ?? [])
}

export function putShared(key: string, content: string, meta?: AuditMeta) {
  return request<Record<string, never>>(`/api/v1/configs/shared/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(withAudit({ content }, meta)),
  })
}

export function deleteShared(key: string, meta?: AuditMeta) {
  return request<Record<string, never>>(`/api/v1/configs/shared/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    body: JSON.stringify(withAudit({}, meta)),
  })
}

export function listServices() {
  return request<{ list: ConfigItem[] }>('/api/v1/configs/services').then((d) => d.list ?? [])
}

export function putService(name: string, content: string, meta?: AuditMeta) {
  return request<Record<string, never>>(`/api/v1/configs/services/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(withAudit({ content }, meta)),
  })
}

export function deleteService(name: string, meta?: AuditMeta) {
  return request<Record<string, never>>(`/api/v1/configs/services/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    body: JSON.stringify(withAudit({}, meta)),
  })
}

export function previewService(name: string) {
  return request<PreviewRes>(`/api/v1/configs/preview/${encodeURIComponent(name)}`)
}

export function seedConfigs(force = false, meta?: AuditMeta) {
  return request<SeedRes>('/api/v1/configs/seed', {
    method: 'POST',
    body: JSON.stringify(withAudit({ force }, meta)),
  })
}

export function listHistory(kind: 'shared' | 'services', key: string) {
  return request<{ list: HistoryItem[] }>(
    `/api/v1/configs/history/${kind}/${encodeURIComponent(key)}`,
  ).then((d) => d.list ?? [])
}

export function rollbackConfig(
  kind: 'shared' | 'services',
  key: string,
  version: number,
  meta?: AuditMeta,
) {
  return request<{ version: number }>('/api/v1/configs/rollback', {
    method: 'POST',
    body: JSON.stringify(withAudit({ kind, key, version }, meta)),
  })
}

export function getHealth() {
  return request<HealthRes>('/api/v1/health')
}
