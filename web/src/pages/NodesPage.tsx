import { useCallback, useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon, RefreshCwIcon, RotateCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { lifecycleDeploy, listNodes, type ContainerInfo, type NodeItem } from '../api/deploy'
import { useConfirm } from '../components/ConfirmProvider'
import { EmptyState } from '../components/EmptyState'
import { InlineAlert } from '../components/InlineAlert'
import { LoadingButton } from '../components/LoadingButton'
import { Meter } from '../components/Meter'
import { PageHeader } from '../components/PageHeader'
import { StatusDot } from '../components/StatusDot'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { notifyError } from '../lib/notify'
import { formatGB, pctOfReported, pctOfUsed } from '../utils/metrics'

function isUp(status: string) {
  return status.toLowerCase().includes('up')
}

function serviceNameOf(containerName: string) {
  return containerName.replace(/^cc-/, '')
}

export function NodesPage() {
  const confirm = useConfirm()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<NodeItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const loadedRef = useRef(false)

  const reload = useCallback(async (silent = false) => {
    setLoading(true)
    try {
      setRows(await listNodes())
    } catch (error) {
      // 10 秒轮询失败只在首次或手动刷新时提示
      if (!silent || !loadedRef.current) notifyError(error, '加载失败')
    } finally {
      loadedRef.current = true
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload(true)
    const timer = setInterval(() => void reload(true), 10_000)
    return () => clearInterval(timer)
  }, [reload])

  const online = rows.filter((row) => row.online).length
  const firstLoad = loading && !loaded

  const onLifecycle = (node: NodeItem, container: ContainerInfo, action: 'start' | 'stop' | 'restart') => {
    const service = serviceNameOf(container.name)
    const label = action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'
    void confirm({
      title: `${label} ${container.name} @ ${node.nodeId}？`,
      description: '由该节点 deploy-agent 执行 docker 操作，约 10 秒内心跳后生效。',
      confirmText: label,
      destructive: action === 'stop',
      onConfirm: async () => {
        const res = await lifecycleDeploy(node.nodeId, service, action)
        toast.success(`已下发任务 #${res.jobId}`)
        await reload()
      },
    })
  }

  return (
    <>
      <PageHeader
        title="节点"
        description="deploy-agent 心跳上报的机器与容器，每 10 秒刷新一次"
        extra={
          <>
            {rows.length > 0 ? (
              <span className="text-muted-foreground text-xs">
                在线 <span className="text-foreground font-medium tabular-nums">{online}</span> /{' '}
                <span className="tabular-nums">{rows.length}</span>
              </span>
            ) : null}
            <LoadingButton variant="outline" loading={loading} onClick={() => void reload()}>
              <RefreshCwIcon />
              刷新
            </LoadingButton>
          </>
        }
      />

      {!firstLoad && rows.length === 0 ? (
        <InlineAlert
          className="mb-4"
          tone="info"
          title="还没有节点上报"
          description="在目标机器上运行 deploy-agent（agent.server 指向配置中心，agent.token 与 auth.agentToken 一致），心跳 10 秒一次。"
        />
      ) : !firstLoad && online === 0 ? (
        <InlineAlert
          className="mb-4"
          tone="warning"
          title="全部节点离线"
          description="Agent 进程可能已停止；恢复运行后约 10 秒内回到在线。"
        />
      ) : null}

      {firstLoad ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="bg-card space-y-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-lg border">
          <EmptyState
            title="暂无节点"
            hint="启动 deploy-agent 后，这里会出现在线机器与容器列表。"
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((node) => {
            const cpuPercent = pctOfReported(node.cpuUsedPercent)
            const memoryPercent = pctOfUsed(node.memoryUsedBytes, node.memoryBytes)
            const containers = node.containers ?? []

            return (
              <Card key={node.nodeId} className="gap-0 py-0">
                <div className="flex items-center gap-2 border-b px-4 py-2.5">
                  <StatusDot tone={node.online ? 'ok' : 'bad'} label={node.online ? '在线' : '离线'} />
                  <span className="truncate text-sm font-semibold">{node.nodeId}</span>
                  {!node.online ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] leading-4">
                      离线
                    </span>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground ml-auto cursor-default text-xs">
                        {node.online ? `agent ${node.agentVersion || '-'}` : '心跳超时'}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      心跳 {node.lastSeen || '-'} · agent {node.agentVersion || '-'}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="flex flex-col gap-3.5 px-4 py-3.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-muted-foreground truncate text-xs">
                        {node.hostname || '-'} · {node.os}/{node.arch} · docker {node.dockerPlatform || '-'}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent>
                      {node.hostname || '-'} · {node.os}/{node.arch} · docker {node.dockerPlatform || '-'}
                    </TooltipContent>
                  </Tooltip>

                  <div className="flex gap-4">
                    <Meter
                      caption={`CPU ${cpuPercent == null ? '未上报' : `${cpuPercent}%`}`}
                      percent={cpuPercent}
                      minWidth={110}
                    />
                    <Meter
                      caption={`内存 ${memoryPercent == null ? '未上报' : `${memoryPercent}% · ${formatGB(node.memoryBytes)}`}`}
                      percent={memoryPercent}
                      minWidth={150}
                    />
                  </div>

                  <div>
                    <div className="text-muted-foreground mb-1.5 flex items-center gap-1 text-xs">
                      本中心容器
                      <span className="text-foreground tabular-nums">{containers.length}</span>
                    </div>
                    {containers.length === 0 ? (
                      <p className="text-muted-foreground text-xs">暂无，去「发布」页发布一个服务</p>
                    ) : (
                      <div className="space-y-1.5">
                        {containers.map((container) => {
                          const up = isUp(container.status)
                          return (
                            <div
                              key={container.name}
                              className="bg-muted/50 hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
                            >
                              <StatusDot tone={up ? 'ok' : 'bad'} label={up ? '运行中' : '已停止'} />
                              <span className="max-w-36 truncate text-[13px] font-medium">{container.name}</span>
                              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={container.image}>
                                {container.image}
                              </span>
                              <span className="flex shrink-0 items-center">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`启动 ${container.name}`}
                                      disabled={!node.online || up}
                                      onClick={() => onLifecycle(node, container, 'start')}
                                    >
                                      <PlayIcon />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>启动</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`停止 ${container.name}`}
                                      disabled={!node.online || !up}
                                      onClick={() => onLifecycle(node, container, 'stop')}
                                    >
                                      <PauseIcon />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>停止</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`重启 ${container.name}`}
                                      disabled={!node.online}
                                      onClick={() => onLifecycle(node, container, 'restart')}
                                    >
                                      <RotateCwIcon />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>重启</TooltipContent>
                                </Tooltip>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
