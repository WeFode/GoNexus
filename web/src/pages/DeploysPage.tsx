import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  CheckIcon,
  CloudUploadIcon,
  FileArchiveIcon,
  InboxIcon,
  Loader2Icon,
  OctagonAlertIcon,
  RefreshCwIcon,
  RocketIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  actionLabel,
  createDeploy,
  jobStatusLabel,
  listArtifacts,
  listDeployJobs,
  listNodes,
  parseJobSemantics,
  promoteDeploy,
  rollbackDeploy,
  uploadArtifact,
  type ArtifactItem,
  type DeployJobItem,
  type NodeItem,
} from '../api/deploy'
import { useConfirm } from '../components/ConfirmProvider'
import { DefinitionList } from '../components/DefinitionList'
import { Dropzone } from '../components/Dropzone'
import { EmptyState } from '../components/EmptyState'
import { InlineAlert } from '../components/InlineAlert'
import { LoadingButton } from '../components/LoadingButton'
import { Meter } from '../components/Meter'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { RecommendPanel } from '../components/RecommendPanel'
import { StatusDot } from '../components/StatusDot'
import { Stepper } from '../components/Stepper'
import { ToneBadge } from '../components/ToneBadge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { notifyError } from '../lib/notify'
import { jobTone } from '../lib/tones'
import { cn } from '../lib/utils'
import { formatGB, formatMB, pctOfReported, pctOfUsed } from '../utils/metrics'

interface UploadTask {
  uid: string
  file: File
  serviceName: string
  imageName: string
  platform: string
  containerPort: number
  status: 'ready' | 'uploading' | 'done' | 'error'
  error?: string
  artifactId?: number
}

function guessMeta(name: string) {
  let serviceName = 'shop-server'
  let imageName = 'shop-server:linux-amd64'
  let platform = 'linux/amd64'
  let containerPort = 8000
  const matched = name.match(/^(.+)-(linux-amd64|linux-arm64)\.tar$/i)
  if (matched) {
    serviceName = matched[1]
    platform = matched[2].replace('-', '/')
    imageName = `${serviceName}:${matched[2]}`
    containerPort = serviceName === 'configure-server' ? 9000 : 8000
  }
  return { serviceName, imageName, platform, containerPort }
}

function platformMatch(artifact: ArtifactItem | undefined, node: NodeItem) {
  if (!artifact?.platform || !node.dockerPlatform) return true
  return artifact.platform.replace('x86_64', 'amd64') === node.dockerPlatform.replace('x86_64', 'amd64')
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  className,
}: {
  label: string
  value?: number
  onChange: (value: number | undefined) => void
  min?: number
  max?: number
  placeholder?: string
  className?: string
}) {
  return (
    <label className={cn('flex items-center gap-2', className)}>
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        className="h-8 w-24"
      />
    </label>
  )
}

function SelectMark({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
      )}
    >
      {checked ? <span className="bg-primary-foreground size-1.5 rounded-full" /> : null}
    </span>
  )
}

function UploadStatus({ task }: { task: UploadTask }) {
  if (task.status === 'uploading') return <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
  if (task.status === 'done')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <CheckCircle2Icon className="text-success size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>已上传 #{task.artifactId}</TooltipContent>
      </Tooltip>
    )
  if (task.status === 'error')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <OctagonAlertIcon className="text-destructive size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{task.error}</TooltipContent>
      </Tooltip>
    )
  return <FileArchiveIcon className="text-muted-foreground size-4" />
}

export function DeploysPage() {
  const confirm = useConfirm()
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const loadedRef = useRef(false)
  const [nodes, setNodes] = useState<NodeItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([])
  const [jobs, setJobs] = useState<DeployJobItem[]>([])
  const [uploads, setUploads] = useState<UploadTask[]>([])
  const [uploading, setUploading] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [rollingId, setRollingId] = useState<number | null>(null)

  // 发布向导状态
  const [artifactId, setArtifactId] = useState<number>()
  const [nodeIds, setNodeIds] = useState<string[]>([])
  const [hostPort, setHostPort] = useState<number>()
  const [strategy, setStrategy] = useState<'canary' | 'all'>('canary')
  const [canaryCount, setCanaryCount] = useState(1)
  const [canaryHostPort, setCanaryHostPort] = useState<number>()
  const [remark, setRemark] = useState('')

  const reload = useCallback(async (silent = false) => {
    setLoading(true)
    try {
      const [nodeList, artifactList, jobList] = await Promise.all([listNodes(), listArtifacts(), listDeployJobs()])
      setNodes(nodeList)
      setArtifacts(artifactList)
      setJobs(jobList)
    } catch (error) {
      // 6 秒一次的轮询失败不反复弹 toast，只在首屏或手动刷新时提示
      if (!silent || !loadedRef.current) notifyError(error, '加载失败')
    } finally {
      loadedRef.current = true
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload(true)
    const timer = setInterval(() => void reload(true), 6000)
    return () => clearInterval(timer)
  }, [reload])

  const online = nodes.filter((node) => node.online)
  const selectedArt = artifacts.find((artifact) => artifact.id === artifactId)
  const sidecarMode = strategy === 'canary' && nodeIds.length === 1 && Boolean(canaryHostPort)
  const effectivePort = hostPort || selectedArt?.containerPort || 8000
  const pendingUploads = uploads.filter((task) => task.status === 'ready' || task.status === 'error').length
  const activeJobs = jobs.filter((job) => ['pending', 'waiting', 'running'].includes(job.status)).length
  const firstLoad = loading && !loaded

  const step = artifactId ? (nodeIds.length > 0 ? 2 : 1) : 0

  const waitingJobs = jobs.filter((job) => job.status === 'waiting')
  const waitingByArtifact = useMemo(() => {
    const map = new Map<number, DeployJobItem[]>()
    for (const job of waitingJobs) {
      const list = map.get(job.artifactId) ?? []
      list.push(job)
      map.set(job.artifactId, list)
    }
    return [...map.entries()]
  }, [waitingJobs])

  const sidecarReady = useMemo(() => {
    const seen = new Set<number>()
    const out: DeployJobItem[] = []
    for (const job of jobs) {
      if (job.action !== 'canary' || job.status !== 'success') continue
      if (
        jobs.some(
          (other) =>
            other.action === 'stop-canary' &&
            other.artifactId === job.artifactId &&
            other.id > job.id &&
            other.status !== 'failed',
        )
      )
        continue
      if (
        jobs.some(
          (other) =>
            other.action === 'deploy' &&
            other.artifactId === job.artifactId &&
            other.nodeId === job.nodeId &&
            other.id > job.id &&
            other.status === 'success',
        )
      )
        continue
      if (jobs.some((other) => other.status === 'waiting' && other.artifactId === job.artifactId)) continue
      if (seen.has(job.artifactId)) continue
      seen.add(job.artifactId)
      out.push(job)
    }
    return out
  }, [jobs])

  // ============ 批量上传 ============
  const onPickFiles = (files: File[]) => {
    const tasks: UploadTask[] = files
      .filter((file) => /\.tar$/i.test(file.name))
      .map((file) => {
        const meta = guessMeta(file.name)
        return {
          uid: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          ...meta,
          status: 'ready' as const,
        }
      })
    if (files.length !== tasks.length) {
      toast.warning('已忽略非 .tar 文件')
    }
    if (tasks.length === 0) return
    setUploads((prev) => [...prev, ...tasks])
  }

  const uploadAll = async () => {
    const pending = uploads.filter((task) => task.status === 'ready' || task.status === 'error')
    if (pending.length === 0) {
      toast.info('没有待上传的文件')
      return
    }
    setUploading(true)
    let okCount = 0
    for (const task of pending) {
      setUploads((prev) => prev.map((item) => (item.uid === task.uid ? { ...item, status: 'uploading' } : item)))
      try {
        const artifact = await uploadArtifact(task.file, {
          serviceName: task.serviceName,
          imageName: task.imageName,
          platform: task.platform,
          containerPort: task.containerPort,
        })
        setUploads((prev) =>
          prev.map((item) =>
            item.uid === task.uid ? { ...item, status: 'done', artifactId: artifact.id, error: undefined } : item,
          ),
        )
        if (!artifactId) {
          setArtifactId(artifact.id)
          setHostPort(artifact.containerPort)
        }
        okCount++
      } catch (error) {
        setUploads((prev) =>
          prev.map((item) =>
            item.uid === task.uid
              ? { ...item, status: 'error', error: error instanceof Error ? error.message : '上传失败' }
              : item,
          ),
        )
      }
    }
    setUploading(false)
    await reload()
    if (okCount > 0) toast.success('上传完成，可在下方选择产物后选择节点发布')
  }

  const removeTask = (uid: string) => setUploads((prev) => prev.filter((task) => task.uid !== uid))

  // ============ 发布 ============
  const toggleNode = (nodeId: string) => {
    setNodeIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]))
  }

  const selectArtifact = (artifact: ArtifactItem) => {
    setArtifactId(artifact.id)
    setHostPort(artifact.containerPort)
    setCanaryHostPort(undefined)
  }

  const confirmDeploy = (ids: string[]) => {
    if (ids.length === 0 || !artifactId) {
      toast.warning('请先选择产物和节点')
      return
    }
    // 按本次要发的节点算平台匹配，避免推荐面板回填后仍用旧选择校验
    const mismatched = nodes.filter((node) => ids.includes(node.nodeId) && !platformMatch(selectedArt, node))
    if (mismatched.length > 0) {
      toast.error(
        `产物平台 ${selectedArt?.platform} 与 ${mismatched.map((node) => node.nodeId).join(',')} 的架构不一致`,
      )
      return
    }
    if (sidecarMode && canaryHostPort === effectivePort) {
      toast.warning('灰度端口不能与主端口相同')
      return
    }
    const artifact = artifacts.find((item) => item.id === artifactId)
    let detail = ''
    if (strategy === 'all') {
      detail = `将同时替换 ${ids.length} 台节点上的主容器。`
    } else if (sidecarMode) {
      detail = `旧容器保持运行；新版本以 cc-${artifact?.serviceName}-canary 监听 ${canaryHostPort}，确认后再「转正」。`
    } else if (ids.length === 1) {
      detail = '发布到该节点并替换主容器。'
    } else {
      detail = `先发前 ${Math.min(canaryCount, ids.length)} 台，其余 ${ids.length - Math.min(canaryCount, ids.length)} 台等待推进。`
    }

    void confirm({
      title: `发布 ${artifact?.serviceName} → ${ids.join('、')}？`,
      description: (
        <>
          镜像 {artifact?.imageName}，主端口 {effectivePort}。{detail}
          <br />
          发布后自动探测健康（/api/v1/health），失败自动回滚旧镜像。
        </>
      ),
      confirmText: '确认发布',
      onConfirm: async () => {
        const res = await createDeploy({
          nodeIds: ids,
          artifactId,
          hostPort,
          remark,
          strategy,
          canaryCount,
          canaryHostPort: sidecarMode ? canaryHostPort : undefined,
        })
        setNodeIds(ids)
        toast.success(`已下发任务 #${res.jobIds.join('、#')}`)
        setRemark('')
        await reload()
      },
    })
  }

  const onRollback = (row: DeployJobItem) => {
    void confirm({
      title: `回滚 ${row.serviceName} @ ${row.nodeId}？`,
      description: '将上一成功版本重新发布为新任务（服务会照常执行健康检查）。历史全部保留。',
      confirmText: '回滚',
      onConfirm: async () => {
        setRollingId(row.id)
        try {
          const res = await rollbackDeploy(row.nodeId, row.serviceName)
          toast.success(`已下发回滚任务 #${res.jobId}`)
          await reload()
        } finally {
          setRollingId(null)
        }
      },
    })
  }

  const onPromote = (aid: number, title: string, content: string) => {
    void confirm({
      title,
      description: content,
      confirmText: '推进',
      onConfirm: async () => {
        setPromoting(true)
        try {
          const res = await promoteDeploy(aid)
          toast.success(`已推进 #${res.jobIds.join('、#')}`)
          await reload()
        } finally {
          setPromoting(false)
        }
      },
    })
  }

  const strategyText =
    strategy === 'all'
      ? `全量（${nodeIds.length} 台）`
      : nodeIds.length > 1
        ? `灰度（先发 ${Math.min(canaryCount, nodeIds.length)} 台）`
        : sidecarMode
          ? `旁路灰度（cc-${selectedArt?.serviceName}-canary : ${canaryHostPort}）`
          : '灰度（单节点）'

  return (
    <>
      <PageHeader
        title="发布"
        description="上传产物后选择节点，灰度或全量一键下发"
        extra={
          <>
            {activeJobs > 0 ? (
              <span className="text-muted-foreground text-xs">
                <span className="text-foreground font-medium tabular-nums">{activeJobs}</span> 个任务进行中
              </span>
            ) : null}
            <LoadingButton variant="outline" loading={loading} onClick={() => void reload()}>
              <RefreshCwIcon />
              刷新
            </LoadingButton>
          </>
        }
      />

      {!firstLoad && online.length === 0 ? (
        <InlineAlert
          className="mb-4"
          tone="warning"
          title="没有在线节点"
          description="在目标机器启动 deploy-agent（心跳 10s 一次）后即可在此发布，无需逐台拷贝 tar。"
        />
      ) : null}

      <div className="bg-card mb-4 rounded-lg border px-4 py-3.5">
        <Stepper
          current={step}
          steps={[
            { title: '上传产物', description: 'tar 文件入镜像仓库' },
            { title: '选择目标', description: '产物 + 节点 + 策略' },
            { title: '确认发布', description: '健康检查与自动回滚' },
          ]}
        />
      </div>

      {/* Step 1 上传产物 */}
      <Panel
        className="mb-4"
        title="上传产物"
        actions={<span className="text-muted-foreground text-xs">支持批量，一次可传多个服务的 tar</span>}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div>
            <Dropzone
              accept=".tar"
              disabled={uploading}
              onFiles={onPickFiles}
              hint={
                <>
                  命名 <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">服务名-linux-amd64.tar</code>{' '}
                  可自动识别元数据
                </>
              }
            />
            <div className="mt-3 flex gap-2">
              <LoadingButton
                className="flex-1"
                loading={uploading}
                disabled={pendingUploads === 0}
                onClick={() => void uploadAll()}
              >
                <CloudUploadIcon />
                {pendingUploads > 0 ? `上传 ${pendingUploads} 个文件` : '上传'}
              </LoadingButton>
              {uploads.length > 0 ? (
                <Button variant="outline" disabled={uploading} onClick={() => setUploads([])}>
                  清空
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-w-0">
            {uploads.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center">
                <EmptyState icon={<InboxIcon />} title="尚未选择文件" hint="拖入或点击左侧区域选择 tar 产物。" />
              </div>
            ) : (
              <ul className="divide-y overflow-hidden rounded-md border">
                {uploads.map((task) => (
                  <li key={task.uid} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex w-4 justify-center">
                        <UploadStatus task={task} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={task.file.name}>
                        {task.file.name}
                      </span>
                      {task.status === 'done' ? <ToneBadge tone="success">#{task.artifactId}</ToneBadge> : null}
                      {task.status === 'error' ? <ToneBadge tone="danger">失败</ToneBadge> : null}
                      {task.status !== 'uploading' ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`移除 ${task.file.name}`}
                          onClick={() => removeTask(task.uid)}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-xs">服务</span>
                        <Input
                          className="h-7 w-28 text-xs"
                          value={task.serviceName}
                          disabled={task.status === 'uploading' || task.status === 'done'}
                          onChange={(event) =>
                            setUploads((prev) =>
                              prev.map((item) =>
                                item.uid === task.uid ? { ...item, serviceName: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-xs">镜像</span>
                        <Input
                          className="h-7 w-48 text-xs"
                          value={task.imageName}
                          disabled={task.status === 'uploading' || task.status === 'done'}
                          onChange={(event) =>
                            setUploads((prev) =>
                              prev.map((item) =>
                                item.uid === task.uid ? { ...item, imageName: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-xs">端口</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="h-7 w-20 text-xs"
                          value={task.containerPort}
                          disabled={task.status === 'uploading' || task.status === 'done'}
                          onChange={(event) =>
                            setUploads((prev) =>
                              prev.map((item) =>
                                item.uid === task.uid
                                  ? { ...item, containerPort: Number(event.target.value) || 8000 }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      {task.status === 'error' ? (
                        <Button variant="link" size="xs" onClick={() => void uploadAll()}>
                          重试
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      {/* Step 2 选择产物与节点 */}
      <Panel
        className="mb-4"
        title="选择产物与目标节点"
        actions={
          selectedArt ? (
            <span className="text-muted-foreground text-xs">
              已选 <span className="text-foreground font-medium tabular-nums">{nodeIds.length}</span> 台
            </span>
          ) : null
        }
        bodyClassName="px-0 py-0"
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4" />
              <TableHead className="w-40">服务</TableHead>
              <TableHead>镜像</TableHead>
              <TableHead className="w-32">平台</TableHead>
              <TableHead className="w-20 text-right">端口</TableHead>
              <TableHead className="w-20 text-right">大小</TableHead>
              <TableHead className="w-44">时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {artifacts.map((artifact) => {
              const selected = artifactId === artifact.id
              return (
                <TableRow
                  key={artifact.id}
                  data-state={selected ? 'selected' : undefined}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => selectArtifact(artifact)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      selectArtifact(artifact)
                    }
                  }}
                >
                  <TableCell className="pl-4">
                    <SelectMark checked={selected} />
                  </TableCell>
                  <TableCell className="text-[13px] font-medium">{artifact.serviceName}</TableCell>
                  <TableCell className="text-muted-foreground max-w-0 truncate font-mono text-xs" title={artifact.imageName}>
                    {artifact.imageName}
                  </TableCell>
                  <TableCell>
                    <ToneBadge tone="neutral">{artifact.platform}</ToneBadge>
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{artifact.containerPort}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{formatMB(artifact.fileSize)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs tabular-nums">{artifact.createdAt}</TableCell>
                </TableRow>
              )
            })}
            {artifacts.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  {firstLoad ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-5/6" />
                    </div>
                  ) : (
                    <EmptyState title="还没有产物" hint="先在上方上传 tar 产物，再回到这里选择。" />
                  )}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="border-t px-4 py-4 sm:px-5">
          {selectedArt ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {online.length === 0 ? (
                  <div className="sm:col-span-2 xl:col-span-3">
                    <EmptyState title="暂无在线节点" hint="启动 deploy-agent 后会自动出现在这里。" />
                  </div>
                ) : (
                  online.map((node) => {
                    const ok = platformMatch(selectedArt, node)
                    const checked = nodeIds.includes(node.nodeId)
                    const memoryPercent = pctOfUsed(node.memoryUsedBytes, node.memoryBytes)
                    const cpuPercent = pctOfReported(node.cpuUsedPercent)
                    return (
                      <button
                        key={node.nodeId}
                        type="button"
                        aria-pressed={checked}
                        onClick={() =>
                          ok
                            ? toggleNode(node.nodeId)
                            : toast.warning(`节点 ${node.nodeId} 平台 ${node.dockerPlatform} 与产物不匹配`)
                        }
                        className={cn(
                          'bg-card rounded-lg border p-3 text-left transition-colors',
                          checked
                            ? 'border-foreground/40 bg-accent/50 ring-foreground/10 ring-1'
                            : 'hover:border-foreground/25',
                          !ok && 'cursor-not-allowed opacity-55 hover:border-border',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                              checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                            )}
                          >
                            {checked ? <CheckIcon className="size-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.nodeId}</span>
                          <StatusDot tone={node.online ? 'ok' : 'bad'} label={node.online ? '在线' : '离线'} />
                        </div>
                        <p className="text-muted-foreground mt-1 truncate pl-6 text-xs">
                          {node.os}/{node.arch} · docker {node.dockerPlatform || '-'}
                        </p>
                        <div className="mt-2.5 flex gap-3 pl-6">
                          <Meter caption={`CPU ${cpuPercent == null ? '-' : `${cpuPercent}%`} · ${node.ncpu}核`} percent={cpuPercent} minWidth={92} />
                          <Meter caption={`内存 ${memoryPercent == null ? '-' : `${memoryPercent}%`}`} percent={memoryPercent} minWidth={92} />
                        </div>
                        <p className="text-muted-foreground mt-2 pl-6 text-xs">
                          内存 {formatGB(node.memoryBytes)} · 容器 <span className="tabular-nums">{node.containers.length}</span>
                        </p>
                      </button>
                    )
                  })
                )}
              </div>

              <div className="bg-muted/30 mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={strategy}
                  onValueChange={(value) => {
                    if (value === 'canary' || value === 'all') setStrategy(value)
                  }}
                >
                  <ToggleGroupItem value="canary">灰度发布</ToggleGroupItem>
                  <ToggleGroupItem value="all">全量发布</ToggleGroupItem>
                </ToggleGroup>

                <NumberField label="主端口" min={1} max={99999} value={hostPort} onChange={setHostPort} />

                {strategy === 'canary' && nodeIds.length > 1 ? (
                  <NumberField label="先发" min={1} max={nodeIds.length} value={canaryCount} onChange={(value) => setCanaryCount(value || 1)} />
                ) : null}
                {strategy === 'canary' && nodeIds.length > 1 ? (
                  <span className="text-muted-foreground text-xs">台</span>
                ) : null}

                {strategy === 'canary' && nodeIds.length === 1 ? (
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0 text-xs">旁路端口</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="可选"
                      value={canaryHostPort ?? ''}
                      onChange={(event) => setCanaryHostPort(event.target.value === '' ? undefined : Number(event.target.value))}
                      className="h-8 w-24"
                    />
                  </label>
                ) : null}

                <Input
                  className="h-8 w-full sm:w-56"
                  placeholder="发布说明（可选）"
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                />
              </div>

              <p className="text-muted-foreground mt-2 text-xs leading-5">
                {strategy === 'canary'
                  ? nodeIds.length > 1
                    ? `灰度：先发 ${Math.min(canaryCount, nodeIds.length)} 台，其余等待人工推进。`
                    : sidecarMode
                      ? '旁路灰度：旧容器不中断，新版本以 cc-<服务>-canary 独立端口运行。'
                      : '灰度：发布到所选节点后，由你在任务区确认是否推进其他节点。'
                  : '全量：一次性替换所有选中节点的主容器。'}
              </p>

              <div className="mt-4">
                <RecommendPanel
                  artifactId={artifactId}
                  hostPort={hostPort}
                  onDeploy={(ids) => {
                    setNodeIds(ids)
                    confirmDeploy(ids)
                  }}
                />
              </div>
            </>
          ) : (
            <InlineAlert
              tone="info"
              title="先在上方表格点选一个产物"
              description="选择产物后此处显示在线节点卡片，可多选。"
            />
          )}
        </div>
      </Panel>

      {/* Step 3 确认发布 */}
      <Panel className="mb-4" title="确认发布">
        <DefinitionList
          items={[
            {
              label: '产物',
              value: selectedArt ? (
                <>
                  <span className="tabular-nums">#{selectedArt.id}</span> {selectedArt.serviceName}
                </>
              ) : (
                <span className="text-muted-foreground">未选择</span>
              ),
            },
            { label: '镜像', value: selectedArt?.imageName ?? '-' },
            { label: '主端口', value: <span className="tabular-nums">{effectivePort}</span> },
            {
              label: '目标节点',
              value:
                nodeIds.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {nodeIds.map((id) => (
                      <ToneBadge key={id} tone="neutral">
                        {id}
                      </ToneBadge>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">未选择</span>
                ),
            },
            { label: '策略', value: strategyText },
            {
              label: '发布后保护',
              value: (
                <ToneBadge tone="success">
                  <ShieldCheckIcon className="size-3" />
                  健康检查失败自动回滚
                </ToneBadge>
              ),
            },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            size="lg"
            disabled={!artifactId || nodeIds.length === 0}
            onClick={() => confirmDeploy(nodeIds)}
          >
            <RocketIcon />
            {strategy === 'all' ? `全量发布（${nodeIds.length} 台）` : '灰度发布'}
          </Button>
          <p className="text-muted-foreground max-w-xl text-xs leading-5">
            Agent 拉取产物 → docker load → 替换容器 → 探测{' '}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">/api/v1/health</code>
            ；失败自动恢复旧镜像并标记任务。
          </p>
        </div>
      </Panel>

      {/* 灰度推进 / 旁路转正 */}
      {waitingByArtifact.map(([id, list]) => (
        <InlineAlert
          key={`waiting-${id}`}
          className="mb-3"
          tone="info"
          icon={<ZapIcon />}
          title={`产物 #${id} 灰度进行中`}
          description={`${list.length} 台节点等待推进。确认灰度节点健康后再发布其余节点。`}
          action={
            <Button
              size="sm"
              disabled={promoting}
              onClick={() => onPromote(id, '推进其余节点？', '等待中的任务变为执行中，由各节点 Agent 拉取执行。')}
            >
              推进其余节点
            </Button>
          }
        />
      ))}

      {sidecarReady.map((job) => (
        <InlineAlert
          key={`sidecar-${job.id}`}
          className="mb-3"
          tone="success"
          icon={<ZapIcon />}
          title={`产物 #${job.artifactId} 旁路灰度已运行`}
          description={`${job.serviceName} @ ${job.nodeId} 的 canary 容器在端口 ${job.hostPort}。转正会替换主容器并下线 canary。`}
          action={
            <Button
              size="sm"
              disabled={promoting}
              onClick={() => onPromote(job.artifactId, '转正旁路灰度？', '将该产物发布为主容器，并删除 cc-*-canary。')}
            >
              转正
            </Button>
          }
        />
      ))}

      {/* 任务区 */}
      <Panel
        title="发布任务"
        actions={
          <span className="text-muted-foreground text-xs">
            共 <span className="text-foreground tabular-nums">{jobs.length}</span> 条 · 每 6 秒刷新
          </span>
        }
        bodyClassName="px-0 py-0"
      >
        <Table className="min-w-[1040px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14 pl-4">#</TableHead>
              <TableHead className="w-32">服务</TableHead>
              <TableHead className="w-24">动作</TableHead>
              <TableHead className="w-28">节点</TableHead>
              <TableHead className="w-56">状态</TableHead>
              <TableHead>说明</TableHead>
              <TableHead className="w-24">操作人</TableHead>
              <TableHead className="w-40">时间</TableHead>
              <TableHead className="w-20 pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const semantics = parseJobSemantics(job)
              return (
                <TableRow key={job.id}>
                  <TableCell className="text-muted-foreground pl-4 text-xs tabular-nums">{job.id}</TableCell>
                  <TableCell className="text-[13px] font-medium">{job.serviceName}</TableCell>
                  <TableCell className="text-[13px]">{actionLabel(job.action)}</TableCell>
                  <TableCell className="text-muted-foreground max-w-28 truncate text-xs" title={job.nodeId}>
                    {job.nodeId}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <ToneBadge tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</ToneBadge>
                      {job.status === 'success' && semantics.healthOk ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <ToneBadge tone="success">
                                <CheckCircle2Icon />
                                健康
                              </ToneBadge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>发布后健康探测通过（/api/v1/health）</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {job.status === 'failed' && semantics.autoRolledBack ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <ToneBadge tone="warning">
                                <ShieldCheckIcon />
                                已自动回滚
                              </ToneBadge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>新版本健康检查失败，已自动恢复旧镜像</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {job.status === 'failed' && semantics.noPrevious ? (
                        <ToneBadge tone="neutral">无旧版本可回滚</ToneBadge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0">
                    {job.message ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground block truncate text-xs">{job.message}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md">{job.message}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-24 truncate text-xs">{job.operator || '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-xs tabular-nums">{job.updatedAt}</TableCell>
                  <TableCell className="pr-4 text-right">
                    {job.status === 'success' && (job.action === 'deploy' || job.action === 'rollback') ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive"
                        disabled={rollingId === job.id}
                        onClick={() => onRollback(job)}
                      >
                        回滚
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
            {jobs.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9}>
                  {firstLoad ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-5/6" />
                    </div>
                  ) : (
                    <EmptyState
                      icon={<TriangleAlertIcon />}
                      title="还没有发布任务"
                      hint="上传产物并确认发布后，任务会在这里每 6 秒刷新状态。"
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Panel>
    </>
  )
}
