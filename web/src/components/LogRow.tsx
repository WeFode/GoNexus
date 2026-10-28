import type { LogItem } from '../api/observability'
import { highlightText } from '../lib/highlight'
import { cn } from '../lib/utils'

const labels = {
  cn: { debug: '调试', info: '信息', warn: '警告', error: '错误' } as Record<string, string>,
  en: { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' } as Record<string, string>,
}

const levelClass: Record<string, string> = {
  debug: 'text-zinc-400 bg-zinc-400/10',
  info: 'text-sky-400 bg-sky-400/10',
  warn: 'text-amber-400 bg-amber-400/10',
  error: 'text-rose-400 bg-rose-400/10',
}

const chipClass = 'rounded bg-white/[0.06] px-1.5 text-[11px] leading-[17px] whitespace-nowrap text-zinc-400'

function statusClass(status: number) {
  if (status >= 500) return 'bg-rose-400/15 text-rose-300'
  if (status >= 400) return 'bg-amber-400/15 text-amber-300'
  if (status >= 300) return 'bg-sky-400/15 text-sky-300'
  return 'bg-emerald-400/15 text-emerald-300'
}

interface LogRowProps {
  item: LogItem
  keyword: string
  /** 服务日志页会额外显示服务列 */
  showService?: boolean
  showSource?: boolean
  /** 可观测页在行尾追加状态、耗时、操作人等标签 */
  showMeta?: boolean
  labelKind?: 'cn' | 'en'
}

export function LogRow({ item, keyword, showService, showSource = true, showMeta, labelKind = 'cn' }: LogRowProps) {
  const level = levelClass[item.level] ? item.level : 'info'
  const time = item.time.length >= 23 ? item.time.slice(11, 23) : item.time

  return (
    <div
      className={cn(
        'flex items-baseline gap-2 border-l-2 border-l-transparent px-3 py-[3px] transition-colors hover:bg-white/[0.045]',
        level === 'warn' && 'border-l-amber-400/70',
        level === 'error' && 'border-l-rose-400/80 bg-rose-500/[0.05] hover:bg-rose-500/[0.09]',
      )}
    >
      <span className="w-[78px] shrink-0 text-[12px] whitespace-nowrap text-zinc-500 tabular-nums sm:w-[86px]">
        {time}
      </span>
      <span
        className={cn(
          'w-10 shrink-0 rounded text-center text-[11px] leading-[18px] font-medium',
          levelClass[level],
        )}
      >
        {labels[labelKind][level] ?? item.level.toUpperCase()}
      </span>
      {showService ? (
        <span className="hidden w-32 shrink-0 truncate text-[12px] text-purple-300/90 sm:block" title={item.service}>
          {item.service ?? '-'}
        </span>
      ) : null}
      {showSource ? (
        <span className="hidden w-12 shrink-0 text-[12px] text-zinc-500 sm:block">{item.source}</span>
      ) : null}
      <span className="min-w-0 flex-1 text-[12.5px] break-words whitespace-pre-wrap text-zinc-300">
        {highlightText(item.message, keyword)}
      </span>
      {showMeta ? (
        <span className="hidden shrink-0 flex-wrap items-center justify-end gap-1 lg:flex">
          {item.status ? <span className={cn(chipClass, statusClass(item.status))}>{item.status}</span> : null}
          {item.durationMs ? (
            <span className={chipClass}>{item.durationMs < 1 ? '<1' : item.durationMs.toFixed(1)}ms</span>
          ) : null}
          {item.service && item.service !== 'configure-server' ? (
            <span className="rounded bg-purple-400/15 px-1.5 text-[11px] leading-[17px] whitespace-nowrap text-purple-300">
              {item.service}
            </span>
          ) : null}
          {item.user ? <span className={chipClass}>@{item.user}</span> : null}
          {item.nodeId ? <span className={chipClass}>{item.nodeId}</span> : null}
          {item.jobId ? <span className={chipClass}>#{item.jobId}</span> : null}
          {item.action ? <span className={cn(chipClass, 'text-zinc-500')}>{item.action}</span> : null}
        </span>
      ) : null}
    </div>
  )
}
