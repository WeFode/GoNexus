import { request } from './client'

export interface ContainerInfo {
  name: string
  image: string
  status: string
  ports: string
}

export interface NodeItem {
  nodeId: string
  hostname: string
  os: string
  arch: string
  dockerPlatform: string
  dockerNetwork: string
  loopbackAs: string
  ncpu: number
  memoryBytes: number
  agentVersion: string
  online: boolean
  lastSeen: string
  containers: ContainerInfo[]
}

export interface ArtifactItem {
  id: number
  serviceName: string
  imageName: string
  platform: string
  containerPort: number
  fileSize: number
  sha256: string
  operator: string
  createdAt: string
}

export interface DeployJobItem {
  id: number
  nodeId: string
  artifactId: number
  serviceName: string
  action: string
  status: string
  imageName: string
  hostPort: number
  message: string
  operator: string
  createdAt: string
  updatedAt: string
}

export function listNodes() {
  return request<{ list: NodeItem[] }>('/api/v1/nodes').then((d) => d.list ?? [])
}

export function listArtifacts(serviceName?: string) {
  const q = serviceName ? `?serviceName=${encodeURIComponent(serviceName)}` : ''
  return request<{ list: ArtifactItem[] }>(`/api/v1/artifacts${q}`).then((d) => d.list ?? [])
}

export function uploadArtifact(file: File, meta: {
  serviceName: string
  imageName: string
  platform: string
  containerPort: number
}) {
  const body = new FormData()
  body.append('file', file)
  body.append('serviceName', meta.serviceName)
  body.append('imageName', meta.imageName)
  body.append('platform', meta.platform)
  body.append('containerPort', String(meta.containerPort))
  return request<ArtifactItem>('/api/v1/artifacts', { method: 'POST', body })
}

export function createDeploy(nodeIds: string[], artifactId: number, hostPort?: number, remark?: string) {
  return request<{ jobIds: number[] }>('/api/v1/deploys', {
    method: 'POST',
    body: JSON.stringify({ nodeIds, artifactId, hostPort: hostPort || 0, remark: remark || '' }),
  })
}

export function rollbackDeploy(nodeId: string, serviceName: string, remark?: string) {
  return request<{ jobId: number }>('/api/v1/deploys/rollback', {
    method: 'POST',
    body: JSON.stringify({ nodeId, serviceName, remark: remark || '' }),
  })
}

export function listDeployJobs(nodeId?: string) {
  const q = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''
  return request<{ list: DeployJobItem[] }>(`/api/v1/deploys${q}`).then((d) => d.list ?? [])
}
