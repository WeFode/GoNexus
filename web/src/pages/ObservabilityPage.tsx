import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowDownToLineIcon,
  ClockIcon,
  DatabaseIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react'
import {
  getObservabilityOverview,
  type MinutePoint,
  type OverviewRes,
  type ServiceItem,
} from '../api/observability'
import { ConsoleIconButton } from '../components/ConsoleIconButton'
import { LogRow } from '../components/LogRow'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatCard } from '../components/StatCard'
import { LoadingButton } from '../components/LoadingButton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import { Skeleton } from '../components/ui/skeleton'
import { useLogStream } from '../hooks/useLogStream'
import { connDot, connText, connTextClass, consoleInputClass, consoleTriggerClass } from '../lib/console'
import { notifyError } from '../lib/notify'
import { cn } from '../lib/utils'

const sourceLabels: Record<string, string> = {
  server: '运行',
  access: '访问',
  agent: '探针',
  deploy: '发布',
  config: '配置',
  auth: '认证',
}

const levelOptions = [
  { value: 'all', label: '全部级别' },
  { value: 'debug', label: '调试' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
]

const statusOrder = ['2xx', '3xx', '4xx', '5xx'] as const

const statusSeg: Record<string, string> = {
  '2xx': 'bg-chart-2',
  '3xx': 'bg-chart-1',
  '4xx': 'bg-chart-3',
  '5xx': 'bg-chart-4',
}

const statusDotClass: Record<string, string> = {
  '2xx': 'bg-chart-2',
  '3xx': 'bg-chart-1',
  '4xx': 'bg-chart-3',
  '5xx': 'bg-chart-4',
}

const methodClass: Record<string, string> = {
  get: 'bg-success/10 text-success',
  post: 'bg-info/10 text-info',
  put: 'bg-warning/10 text-warning',
  delete: 'bg-destructive/10 text-destructive',
  patch: 'bg-chart-5/10 text-chart-5',
  other: 'bg-muted text-muted-foreground',
}

function formatNumber(value: number) {
  return value.toLocaleString('zh-CN')
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function methodKey(method: string) {
  const key = method.toLowerCase()
  return ['get', 'post', 'put', 'delete', 'patch'].includes(key) ? key : 'other'
}

const CHART_W = 720
const CHART_H = 208
const CHART_PAD = { top: 14, right: 10, bottom: 24, left: 40 }

function TrafficChart({ points }: { points: MinutePoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  const step = plotW / Math.max(points.length, 1)
  const barW = Math.max(step * 0.56, 2)
  const maxTotal = Math.max(0, ...points.map((point) => point.total))
  const niceMax = maxTotal <= 4 ? 4 : Math.ceil(maxTotal / 4) * 4
  const baseY = CHART_PAD.top + plotH

  const active = hover === null ? null : points[hover]
  // 首尾柱子把提示框往内收，避免贴近卡片边缘时被裁掉
  const tipLeft =
    hover === null
      ? 0
      : Math.min(90, Math.max(10, ((CHART_PAD.left + hover * step + step / 2) / CHART_W) * 100))
  const tipStyle: CSSProperties | undefined = hover === null ? undefined : { left: `${tipLeft}%` }

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="最近 30 分钟请求量"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="obsBarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="obsErrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--destructive)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--destructive)" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = CHART_PAD.top + plotH * fraction
          const label = Math.round(niceMax * (1 - fraction))
          return (
            <g key={fraction}>
              <line
                x1={CHART_PAD.left}
                x2={CHART_W - CHART_PAD.right}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={fraction === 1 ? undefined : '4 5'}
              />
              <text x={CHART_PAD.left - 8} y={y + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px]">
                {label}
              </text>
            </g>
          )
        })}

        {points.map((point, index) => {
          const x = CHART_PAD.left + index * step + (step - barW) / 2
          const height = (point.total / niceMax) * plotH
          const errorHeight = point.errors > 0 ? Math.max(2, (point.errors / niceMax) * plotH) : 0
          const dim = hover !== null && hover !== index
          return (
            <g key={`${point.minute}-${index}`}>
              <rect
                x={x}
                y={baseY - height}
                width={barW}
                height={Math.max(height, point.total > 0 ? 2 : 0)}
                rx={2}
                fill="url(#obsBarFill)"
                opacity={dim ? 0.4 : 1}
              />
              {errorHeight > 0 ? (
                <rect
                  x={x}
                  y={baseY - errorHeight}
                  width={barW}
                  height={errorHeight}
                  rx={1.5}
                  fill="url(#obsErrFill)"
                  opacity={dim ? 0.5 : 1}
                />
              ) : null}
              <rect
                x={CHART_PAD.left + index * step}
                y={CHART_PAD.top}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
            </g>
          )
        })}

        {points.map((point, index) => {
          if (![0, 9, 19, 29].includes(index) || index >= points.length) return null
          const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
          return (
            <text
              key={`x-${point.minute}`}
              x={CHART_PAD.left + index * step + step / 2}
              y={CHART_H - 6}
              textAnchor={anchor}
              className="fill-muted-foreground text-[10px]"
            >
              {point.minute}
            </text>
          )
        })}
      </svg>

      {maxTotal === 0 ? (
        <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-xs">
          最近 30 分钟暂无请求
        </div>
      ) : null}

      {active ? (
        <div
          className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-1 z-10 flex w-36 -translate-x-1/2 flex-col gap-0.5 rounded-md border p-2 text-[11px] shadow-md"
          style={tipStyle}
        >
          <span className="text-muted-foreground">{active.minute}</span>
          <span className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">请求</span>
            <b className="font-semibold">{formatNumber(active.total)}</b>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">5xx</span>
            <b className="font-semibold">{formatNumber(active.errors)}</b>
          </span>
          <span className="text-muted-foreground">
            P95 {active.p95Ms.toFixed(0)}ms · 均 {active.avgMs.toFixed(1)}ms
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function ObservabilityPage() {
  const [overview, setOverview] = useState<OverviewRes | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [overviewLoaded, setOverviewLoaded] = useState(false)
  const [level, setLevel] = useState('all')
  const [source, setSource] = useState('all')
  const [service, setService] = useState('all')
  const [keyword, setKeyword] = useState('')
  const overviewLoadedRef = useRef(false)

  const { logs, setLogs, sources, services, live, setLive, conn, stick, boxRef, handleScroll, jumpLatest } =
    useLogStream({ limit: 300, maxItems: 1200 })

  const reloadOverview = useCallback(async (silent: boolean) => {
    if (!silent) setMetricsLoading(true)
    try {
      const data = await getObservabilityOverview()
      setOverview(data)
      overviewLoadedRef.current = true
    } catch (error) {
      if (!silent || !overviewLoadedRef.current) notifyError(error, '可观测指标加载失败')
    } finally {
      if (!silent) setMetricsLoading(false)
      setOverviewLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reloadOverview(true)
    const timer = setInterval(() => void reloadOverview(true), 10_000)
    return () => clearInterval(timer)
  }, [reloadOverview])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return logs.filter((item) => {
      if (level !== 'all' && item.level !== level) return false
      if (source !== 'all' && item.source !== source) return false
      if (service !== 'all' && item.service !== service) return false
      if (!kw) return true
      return [item.message, item.path, item.user, item.nodeId, item.action].some(
        (field) => field && field.toLowerCase().includes(kw),
      )
    })
  }, [logs, level, source, service, keyword])

  const sourceOptions = useMemo(
    () => [{ value: 'all', label: '全部来源' }, ...sources.map((item) => ({ value: item, label: sourceLabels[item] ?? item }))],
    [sources],
  )

  const serviceOptions = useMemo(() => {
    const names = new Set(services.map((item: ServiceItem) => item.name))
    logs.forEach((item) => {
      if (item.service) names.add(item.service)
    })
    return [
      { value: 'all', label: '全部服务' },
      ...Array.from(names)
        .sort()
        .map((name) => ({ value: name, label: name })),
    ]
  }, [services, logs])

  const statusMap = useMemo(() => {
    const map: Record<string, number> = {}
    overview?.statuses.forEach((item) => {
      map[item.key] = item.count
    })
    return map
  }, [overview])

  const statusTotal = statusOrder.reduce((sum, key) => sum + (statusMap[key] ?? 0), 0)
  const errorCount = statusMap['5xx'] ?? 0
  const errorRatePct = (overview?.errorRate ?? 0) * 100
  const runtime = overview?.runtime
  const buffer = overview?.buffer
  const firstLoad = !overviewLoaded && !overview

  return (
    <>
      <PageHeader
        title="可观测"
        description="请求流量、运行时指标与实时运行日志，帮助快速定位问题"
        extra={
          <>
            {overview ? <span className="text-muted-foreground text-xs">更新于 {overview.generatedAt}</span> : null}
            <LoadingButton variant="outline" loading={metricsLoading} onClick={() => void reloadOverview(false)}>
              <RefreshCwIcon />
              刷新
            </LoadingButton>
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
              tone="info"
              label="请求总数"
              value={overview ? formatNumber(overview.requestTotal) : '—'}
              hint={
                overview ? (
                  <>
                    RPS <span className="tabular-nums">{overview.rps}</span> · 处理中{' '}
                    <span className="tabular-nums">{overview.inFlight}</span>
                  </>
                ) : (
                  '等待指标上报'
                )
              }
            />
            <StatCard
              icon={<TriangleAlertIcon />}
              tone={errorCount === 0 ? 'success' : errorRatePct >= 1 ? 'danger' : 'warning'}
              label="错误率"
              value={overview ? `${errorRatePct.toFixed(2)}%` : '—'}
              hint={overview ? `5xx ${formatNumber(errorCount)} 次` : '等待指标上报'}
            />
            <StatCard
              icon={<ClockIcon />}
              tone={(overview?.p95Ms ?? 0) > 500 ? 'warning' : 'info'}
              label="P95 延迟"
              value={overview ? `${overview.p95Ms.toFixed(0)} ms` : '—'}
              hint={overview ? `平均 ${overview.avgMs.toFixed(1)} ms` : '等待指标上报'}
            />
            <StatCard
              icon={<DatabaseIcon />}
              tone="neutral"
              label="日志缓冲"
              value={buffer ? `${formatNumber(buffer.size)} / ${formatNumber(buffer.capacity)}` : '—'}
              hint={buffer ? `累计 ${formatNumber(buffer.total)} 条 · 订阅 ${buffer.clients}` : '等待日志采集'}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="请求流量 · 最近 30 分钟"
          actions={
            <div className="text-muted-foreground flex items-center gap-3.5 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <i className="bg-chart-1 size-2 rounded-full" /> 请求
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="bg-destructive size-2 rounded-full" /> 5xx
              </span>
            </div>
          }
        >
          <TrafficChart points={overview?.minutes ?? []} />

          <Separator className="my-4" />

          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[13px] font-medium">Top 路由</span>
            <span className="text-muted-foreground text-xs">按最近 30 分钟访问量排序</span>
          </div>
          {!overview || overview.routes.length === 0 ? (
            <p className="text-muted-foreground text-xs">最近 30 分钟暂无路由数据</p>
          ) : (
            <div className="space-y-1">
              {overview.routes.slice(0, 6).map((route) => (
                <div
                  key={`${route.method} ${route.route}`}
                  className="bg-muted/40 hover:bg-muted grid grid-cols-[46px_minmax(0,1fr)_56px_56px] items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors sm:grid-cols-[48px_minmax(0,1fr)_60px_60px_56px]"
                >
                  <span
                    className={cn(
                      'rounded px-1 text-center font-mono text-[10px] leading-[18px] font-semibold uppercase',
                      methodClass[methodKey(route.method)],
                    )}
                  >
                    {route.method}
                  </span>
                  <span className="truncate font-mono text-xs" title={route.route}>
                    {route.route}
                  </span>
                  <span className="text-muted-foreground text-right text-xs tabular-nums">
                    {formatNumber(route.count)}
                  </span>
                  <span className="text-muted-foreground hidden text-right text-xs tabular-nums sm:block">
                    {route.avgMs.toFixed(1)}ms
                  </span>
                  <span
                    className={cn(
                      'text-right text-[11px]',
                      route.errors > 0 ? 'text-destructive font-medium' : 'text-muted-foreground/60',
                    )}
                  >
                    {route.errors > 0 ? `5xx ${route.errors}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="状态与运行时">
          <div className="mb-2 text-[13px] font-medium">状态分布</div>
          {statusTotal === 0 ? (
            <p className="text-muted-foreground text-xs">暂无请求</p>
          ) : (
            <div className="bg-muted mb-3 flex h-2.5 overflow-hidden rounded-full">
              {statusOrder.map((key) => {
                const count = statusMap[key] ?? 0
                if (count === 0) return null
                return (
                  <span
                    key={key}
                    className={cn('h-full transition-[width] duration-300', statusSeg[key])}
                    style={{ width: `${(count / statusTotal) * 100}%` }}
                    title={`${key} ${count}`}
                  />
                )
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {statusOrder.map((key) => {
              const count = statusMap[key] ?? 0
              return (
                <div key={key} className="grid grid-cols-[8px_28px_minmax(0,1fr)_38px] items-center gap-2 text-xs">
                  <i className={cn('size-2 rounded-full', statusDotClass[key])} />
                  <span className="text-muted-foreground">{key}</span>
                  <span className="text-right font-medium tabular-nums">{formatNumber(count)}</span>
                  <span className="text-muted-foreground text-right tabular-nums">
                    {statusTotal ? `${((count / statusTotal) * 100).toFixed(0)}%` : '0%'}
                  </span>
                </div>
              )
            })}
          </div>

          <Separator className="my-4" />

          <div className="mb-2 text-[13px] font-medium">运行时</div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Goroutines', value: runtime ? runtime.goroutines : '—' },
              { label: '堆内存', value: runtime ? `${runtime.heapAllocMB} MB` : '—' },
              { label: 'GC 次数', value: runtime ? runtime.numGC : '—' },
              { label: '运行时长', value: runtime ? formatUptime(runtime.uptimeSec) : '—' },
            ].map((item) => (
              <div key={item.label} className="bg-muted/50 rounded-md px-3 py-2">
                <div className="text-muted-foreground text-xs leading-4">{item.label}</div>
                <div className="mt-0.5 text-base leading-6 font-semibold tabular-nums">{item.value}</div>
              </div>
            ))}
          </div>
          {runtime ? (
            <div className="text-muted-foreground mt-2.5 space-y-0.5 text-xs leading-5 break-all">
              <div>
                {runtime.goVersion} · {runtime.numCPU} 核 · Heap inuse {runtime.heapInuseMB} MB · Sys {runtime.sysMB} MB
              </div>
              <div>启动于 {runtime.startedAt}</div>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="console-shell mt-4">
        <div className="console-head">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn('console-dot', connDot[conn])} style={conn === 'live' ? { animation: 'cc-live-pulse 2s ease-out infinite' } : undefined} />
            <span className="text-sm font-medium text-zinc-100">实时日志</span>
            <span className={cn('text-xs', connTextClass[conn])}>{connText[conn]}</span>
          </div>
          <div className="console-tools">
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger size="sm" className={consoleTriggerClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {levelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger size="sm" className={consoleTriggerClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger size="sm" className={cn(consoleTriggerClass, 'min-w-[110px]')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serviceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索消息 / 服务 / 用户"
                aria-label="搜索日志"
                className={cn(consoleInputClass, 'w-44 sm:w-52')}
              />
            </div>

            <ConsoleIconButton label={live ? '暂停实时推送' : '继续实时推送'} onClick={() => setLive(!live)}>
              {live ? <PauseIcon /> : <PlayIcon />}
            </ConsoleIconButton>
            <ConsoleIconButton
              label="清空当前视图"
              disabled={logs.length === 0}
              onClick={() => {
                setLogs([])
                jumpLatest()
              }}
            >
              <Trash2Icon />
            </ConsoleIconButton>
          </div>
        </div>

        <div className="console-bar">
          <span>
            显示 <b>{filtered.length}</b> / {logs.length} 条
          </span>
          {buffer ? (
            <span>
              缓冲 {buffer.size}/{buffer.capacity} · 订阅 {buffer.clients}
            </span>
          ) : null}
          <span className="ml-auto">
            {level === 'all' ? '全部级别' : (levelOptions.find((option) => option.value === level)?.label ?? level)} ·{' '}
            {source === 'all' ? '全部来源' : (sourceLabels[source] ?? source)} ·{' '}
            {service === 'all' ? '全部服务' : service}
          </span>
        </div>

        <div
          ref={boxRef}
          onScroll={handleScroll}
          className="console-scroll console-body h-[520px]"
        >
          {filtered.length === 0 ? (
            <div className="console-empty">
              <span className="console-empty-title">
                {logs.length === 0 ? '暂无日志' : '没有匹配的日志'}
              </span>
              <span className="console-empty-hint">
                {logs.length === 0 ? '请求接口或等待服务输出后，日志会在这里实时出现' : '试试调整级别、来源或关键词'}
              </span>
            </div>
          ) : (
            filtered.map((item) => <LogRow key={item.id} item={item} keyword={keyword} showMeta />)
          )}
        </div>

        {!stick ? (
          <button
            type="button"
            onClick={jumpLatest}
            className="console-jump bottom-5"
          >
            <ArrowDownToLineIcon className="size-3.5" />
            回到最新
          </button>
        ) : null}
      </div>
    </>
  )
}
