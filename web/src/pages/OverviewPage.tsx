import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRightIcon,
  BoxesIcon,
  DatabaseIcon,
  FilePlus2Icon,
  RefreshCwIcon,
  RocketIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  ZapIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { getHealth, listServices, listShared, seedConfigs, type HealthRes } from '../api/config'
import { actionLabel, jobStatusLabel, listDeployJobs, listNodes, type DeployJobItem } from '../api/deploy'
import { useConfirm } from '../components/ConfirmProvider'
import { EmptyState } from '../components/EmptyState'
import { IconTile, type Tone } from '../components/IconTile'
import { LoadingButton } from '../components/LoadingButton'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatCard } from '../components/StatCard'
import { StatusLine } from '../components/StatusDot'
import { ToneBadge } from '../components/ToneBadge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { notifyError } from '../lib/notify'
import { jobTone } from '../lib/tones'

const quickActions = [
  {
    key: 'deploy',
    icon: <RocketIcon />,
    tone: 'info' as Tone,
    title: '发布新版本',
    hint: '上传 tar 产物，灰度或全量下发到多节点',
    path: '/deploys',
  },
  {
    key: 'service',
    icon: <FilePlus2Icon />,
    tone: 'success' as Tone,
    title: '新增服务配置',
    hint: '为单个微服务接入配置中心',
    path: '/services',
  },
  {
    key: 'shared',
    icon: <Settings2Icon />,
    tone: 'warning' as Tone,
    title: '修改公共配置',
    hint: '全部服务共享，保存即热推送',
    path: '/shared',
  },
]

export function OverviewPage() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [health, setHealth] = useState<HealthRes | null>(null)
  const [serviceNames, setServiceNames] = useState<string[]>([])
  const [sharedCount, setSharedCount] = useState(0)
  const [onlineNodes, setOnlineNodes] = useState(0)
  const [totalNodes, setTotalNodes] = useState(0)
  const [jobs, setJobs] = useState<DeployJobItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const loadedRef = useRef(false)

  const reload = useCallback(async (silent = false) => {
    setLoading(true)
    try {
      const [h, shared, services, nodes, jobList] = await Promise.all([
        getHealth(),
        listShared(),
        listServices(),
        listNodes(),
        listDeployJobs(),
      ])
      setHealth(h)
      setSharedCount(shared.length)
      setServiceNames(services.map((service) => service.key))
      setOnlineNodes(nodes.filter((node) => node.online).length)
      setTotalNodes(nodes.length)
      setJobs(jobList.slice(0, 8))
    } catch (error) {
      // 轮询失败不重复打扰，只在首屏失败或用户手动刷新时提示
      if (!silent || !loadedRef.current) notifyError(error, '加载失败')
    } finally {
      loadedRef.current = true
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload(true)
    const timer = setInterval(() => void reload(true), 15_000)
    return () => clearInterval(timer)
  }, [reload])

  const onSeed = (force: boolean) => {
    void confirm({
      title: force ? '强制覆盖 seed？' : '写入缺失的 seed？',
      description: force
        ? '会用本地 manifest/etcd-seed 覆盖 etcd 中已有配置，所有服务将热加载变更。'
        : '只写入 etcd 中尚不存在的 key，不影响现有配置。',
      confirmText: force ? '覆盖写入' : '写入缺失项',
      destructive: force,
      onConfirm: async () => {
        setSeeding(true)
        try {
          const res = await seedConfigs(force, { remark: force ? 'force seed' : 'seed missing' })
          toast.success(`已写入 ${res.written} 条`)
          await reload()
        } finally {
          setSeeding(false)
        }
      },
    })
  }

  const etcdOk = health?.status === 'ok'
  const firstLoad = loading && !loaded

  return (
    <>
      <PageHeader
        title="概览"
        description="配置源、接入规模与最近一次发布的运行状态"
        extra={
          <>
            <LoadingButton variant="outline" loading={loading} onClick={() => void reload()}>
              <RefreshCwIcon />
              刷新
            </LoadingButton>
            <LoadingButton variant="outline" loading={seeding} onClick={() => onSeed(false)}>
              写入 seed
            </LoadingButton>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive border-destructive/40 hover:border-destructive/60"
              disabled={seeding}
              onClick={() => onSeed(true)}
            >
              强制覆盖
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {firstLoad ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="bg-card rounded-lg border p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-3 h-7 w-2/3" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              icon={<ZapIcon />}
              tone={etcdOk ? 'success' : 'danger'}
              label="etcd 配置源"
              value={<StatusLine tone={etcdOk ? 'ok' : 'bad'}>{etcdOk ? '正常' : '异常'}</StatusLine>}
              hint={etcdOk ? 'watch 推送中，保存即生效' : '服务将回退使用本地快照'}
            />
            <StatCard
              icon={<DatabaseIcon />}
              tone="info"
              label="公共配置"
              value={sharedCount}
              hint={`变更热推送至全部 ${serviceNames.length || '—'} 个服务`}
              onClick={() => navigate('/shared')}
            />
            <StatCard
              icon={<ServerIcon />}
              tone="info"
              label="服务配置"
              value={serviceNames.length}
              hint={serviceNames.length ? serviceNames.join(' · ') : '尚无服务接入'}
              onClick={() => navigate('/services')}
            />
            <StatCard
              icon={<BoxesIcon />}
              tone={totalNodes === 0 ? 'neutral' : onlineNodes === totalNodes ? 'success' : 'warning'}
              label="在线节点"
              value={
                <>
                  {onlineNodes}
                  <span className="text-muted-foreground text-sm font-normal"> / {totalNodes}</span>
                </>
              }
              hint="deploy-agent 心跳上报"
              onClick={() => navigate('/nodes')}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel
          title="常用操作"
          className="xl:col-span-1"
          footer={
            <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheckIcon className="text-success size-3.5" />
                发布自动健康检查
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheckIcon className="text-success size-3.5" />
                失败自动回滚旧镜像
              </span>
            </div>
          }
        >
          <div className="space-y-2">
            {quickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={() => navigate(action.path)}
                className="group border-border hover:border-foreground/25 hover:bg-accent/40 flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
              >
                <IconTile tone={action.tone} size="sm">
                  {action.icon}
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{action.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">{action.hint}</span>
                </span>
                <ArrowRightIcon className="text-muted-foreground/60 group-hover:text-foreground size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title="最近发布任务"
          className="xl:col-span-2"
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('/deploys')}>
              查看全部
              <ArrowRightIcon />
            </Button>
          }
          bodyClassName="px-0 py-0"
          loading={firstLoad}
        >
          {jobs.length === 0 ? (
            <EmptyState title="还没有发布任务" hint="从「发布新版本」开始，上传一次产物即可多节点下发。" />
          ) : (
            <ul className="divide-y">
              {jobs.map((job) => (
                <li key={job.id} className="hover:bg-muted/40 flex flex-col gap-1 px-4 py-2.5 transition-colors sm:px-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <ToneBadge tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</ToneBadge>
                    <span className="truncate text-sm font-medium">{job.serviceName}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {actionLabel(job.action)} → {job.nodeId}
                    </span>
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                      {job.updatedAt || job.createdAt}
                    </span>
                  </div>
                  {job.message ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground truncate text-xs">{job.message}</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-md">{job.message}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
