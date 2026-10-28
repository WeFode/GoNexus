import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLineIcon,
  Code2Icon,
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import type { LogItem, ServiceItem } from '../api/observability'
import { ConsoleIconButton } from '../components/ConsoleIconButton'
import { LogRow } from '../components/LogRow'
import { PageHeader } from '../components/PageHeader'
import { StatusDot } from '../components/StatusDot'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useLogStream } from '../hooks/useLogStream'
import {
  connDot,
  connTextClass,
  connTextShort,
  consoleInputClass,
  consoleTriggerClass,
} from '../lib/console'
import { cn } from '../lib/utils'

const levelOptions = [
  { value: 'all', label: '全部级别' },
  { value: 'debug', label: '调试' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
]

const connText = connTextShort

const levelName: Record<string, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' }

function timeAgo(ts: number) {
  if (!ts) return '暂无输出'
  const diff = Date.now() - ts
  if (diff < 10_000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 10_000) * 10}s 前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m 前`
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

export function ServiceLogsPage() {
  const { logs, setLogs, services, live, setLive, conn, stick, boxRef, handleScroll, jumpLatest } = useLogStream({
    limit: 1000,
    maxItems: 2000,
    pollServices: true,
  })
  const [selected, setSelected] = useState('all')
  const [level, setLevel] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [focus, setFocus] = useState(false)

  const scoped = useMemo(
    () => (selected === 'all' ? logs : logs.filter((item) => item.service === selected)),
    [logs, selected],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return scoped.filter((item) => {
      if (level !== 'all' && item.level !== level) return false
      if (!kw) return true
      return [item.message, item.path, item.service, item.user, item.action].some(
        (field) => field && field.toLowerCase().includes(kw),
      )
    })
  }, [scoped, level, keyword])

  useEffect(() => {
    if (!focus) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocus(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focus])

  const download = () => {
    if (filtered.length === 0) return
    const text = filtered
      .map(
        (item: LogItem) =>
          `${item.time} ${levelName[item.level] ?? item.level.toUpperCase()} [${item.service ?? '-'}] [${item.source}] ${item.message}`,
      )
      .join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selected === 'all' ? 'cluster' : selected}-${Date.now()}.log`
    link.click()
    URL.revokeObjectURL(url)
  }

  const selectedService = services.find((service: ServiceItem) => service.name === selected)
  const serviceLabel = selected === 'all' ? '全部服务' : selected
  const command = selected === 'all' ? 'tail -f *.log' : `tail -f ${selected}.log`

  return (
    <>
      {!focus ? (
        <PageHeader
          title="服务日志"
          description="在线查看各微服务的实时运行日志"
          extra={
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <Code2Icon className="size-3.5" />
              日志由各服务内的 SDK 主动上报
            </span>
          }
        />
      ) : null}

      <div
        className={cn(
          'grid min-h-0 gap-4',
          focus
            ? 'bg-background fixed inset-0 z-40 h-dvh grid-cols-1 grid-rows-[minmax(0,1fr)] p-3'
            : 'lg:grid-cols-[208px_minmax(0,1fr)]',
        )}
      >
        {!focus ? (
          <aside className="bg-card flex flex-col overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2.5">
              <span className="text-xs font-medium">服务</span>
              <span className="text-muted-foreground text-xs tabular-nums">{services.length}</span>
            </div>
            <div className="max-h-64 overflow-y-auto p-1.5 lg:max-h-none lg:flex-1">
              <button
                type="button"
                onClick={() => setSelected('all')}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  selected === 'all' ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <StatusDot tone="ok" label="在线" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">全部服务</span>
                  <span className="text-muted-foreground block text-[11px]">{logs.length} 条缓冲</span>
                </span>
              </button>
              {services.length === 0 ? (
                <p className="text-muted-foreground px-2 py-3 text-xs">等待服务接入…</p>
              ) : (
                services.map((service) => {
                  const online = service.name === 'configure-server' || Date.now() - service.seenAt < 90_000
                  return (
                    <button
                      key={service.name}
                      type="button"
                      onClick={() => setSelected(service.name)}
                      title={`${service.name} · ${service.count} 条 · ${timeAgo(service.lastTs)}`}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        selected === service.name ? 'bg-accent' : 'hover:bg-accent/60',
                      )}
                    >
                      <StatusDot tone={online ? 'ok' : 'idle'} label={online ? '在线' : '离线'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{service.name}</span>
                        <span className="text-muted-foreground block text-[11px]">
                          {service.count.toLocaleString('zh-CN')} 条 · {timeAgo(service.lastTs)}
                        </span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <i className="bg-success size-2 rounded-full" /> 在线
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="bg-muted-foreground/50 size-2 rounded-full" /> 离线
              </span>
            </div>
          </aside>
        ) : null}

        <section className="console-shell flex min-h-0 flex-col">
          <div className="console-head">
            <div className="flex min-w-0 items-center gap-3">
              <span className="hidden items-center gap-1 sm:flex">
                <i className="size-2.5 rounded-full bg-rose-400/80" />
                <i className="size-2.5 rounded-full bg-amber-400/80" />
                <i className="size-2.5 rounded-full bg-emerald-400/80" />
              </span>
              <span className="truncate text-sm font-medium text-zinc-100">{serviceLabel}</span>
              <span className="hidden truncate font-mono text-xs text-zinc-500 sm:block">{command}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 text-xs', connTextClass[conn])}>
                <i
                  className={cn('console-dot', connDot[conn])}
                  style={conn === 'live' ? { animation: 'cc-live-pulse 2s ease-out infinite' } : undefined}
                />
                {connText[conn]}
              </span>
              <ConsoleIconButton label={focus ? '退出全屏' : '全屏'} onClick={() => setFocus(!focus)}>
                {focus ? <Minimize2Icon /> : <Maximize2Icon />}
              </ConsoleIconButton>
            </div>
          </div>

          <div className="console-tools border-b border-white/5 bg-black/30 px-3.5 py-2">
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

            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索日志内容 / 服务 / 路径"
                aria-label="搜索日志"
                className={cn(consoleInputClass, 'w-52 sm:w-64')}
              />
            </div>

            <span className="ml-auto" />
            <ConsoleIconButton label={live ? '暂停实时推送' : '继续并补齐暂停期间的日志'} onClick={() => setLive(!live)}>
              {live ? <PauseIcon /> : <PlayIcon />}
            </ConsoleIconButton>
            <ConsoleIconButton
              label="清空当前视图"
              disabled={scoped.length === 0}
              onClick={() => {
                setLogs((prev) => (selected === 'all' ? [] : prev.filter((item) => item.service !== selected)))
                jumpLatest()
              }}
            >
              <Trash2Icon />
            </ConsoleIconButton>
            <ConsoleIconButton label="下载当前视图" disabled={filtered.length === 0} onClick={download}>
              <DownloadIcon />
            </ConsoleIconButton>
          </div>

          <div
            ref={boxRef}
            onScroll={handleScroll}
            className={cn('console-scroll console-body', focus && 'flex-1')}
            style={focus ? undefined : { height: 560 }}
          >
            {filtered.length === 0 ? (
              <div className="console-empty">
                <span className="flex size-10 items-center justify-center rounded-lg bg-white/5 text-zinc-500">
                  <Code2Icon className="size-5" />
                </span>
                <span className="console-empty-title">
                  {scoped.length === 0
                    ? selected === 'all'
                      ? '等待日志输出…'
                      : '该服务暂无日志'
                    : '没有匹配的日志'}
                </span>
                <span className="console-empty-hint">
                  {scoped.length === 0 ? '启动微服务或访问它的接口后，日志会在这里实时滚动。' : '试试调整级别或清空关键字。'}
                </span>
              </div>
            ) : (
              filtered.map((item) => (
                <LogRow key={item.id} item={item} keyword={keyword} showService showSource labelKind="en" />
              ))
            )}
          </div>

          {!stick ? (
            <button
              type="button"
              onClick={jumpLatest}
              className="console-jump bottom-12"
            >
              <ArrowDownToLineIcon className="size-3.5" />
              回到最新
            </button>
          ) : null}

          <div className="console-bar border-t border-b-0 text-[11px]">
            <span>
              显示 <b>{filtered.length}</b> / {scoped.length} 行
            </span>
            <span>
              {serviceLabel}
              {selectedService ? ` · 累计 ${selectedService.count.toLocaleString('zh-CN')} 条` : ''}
            </span>
            <span className="ml-auto">
              UTF-8 · LF{keyword ? ` · /${keyword}/` : ''} · {live ? '跟随中' : '已暂停'}
            </span>
          </div>
        </section>
      </div>
    </>
  )
}
