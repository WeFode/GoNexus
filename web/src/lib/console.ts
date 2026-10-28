import type { ConnState } from '../hooks/useLogStream'

/** 控制台连接状态文案与配色，可观测页与服务日志页共用 */
export const connText: Record<ConnState, string> = {
  connecting: '连接中',
  live: '实时推送中',
  paused: '已暂停',
  error: '连接已断开',
}

/** 服务日志页的终端风格短文案 */
export const connTextShort: Record<ConnState, string> = {
  ...connText,
  live: 'LIVE',
  error: '连接断开',
}

export const connDot: Record<ConnState, string> = {
  connecting: 'bg-amber-400',
  live: 'bg-emerald-400',
  paused: 'bg-zinc-500',
  error: 'bg-rose-400',
}

export const connTextClass: Record<ConnState, string> = {
  connecting: 'text-amber-400',
  live: 'text-emerald-400',
  paused: 'text-zinc-400',
  error: 'text-rose-400',
}

/** Select 触发器需要压过 shadcn 的默认尺寸/边框，因此放在 TS 常量里走 className 合并 */
export const consoleTriggerClass =
  'h-7 w-auto min-w-24 border-white/10 bg-white/5 px-2 text-xs text-zinc-300 hover:bg-white/10 focus-visible:border-white/30 focus-visible:ring-white/15 [&_svg]:text-zinc-500'

export const consoleInputClass =
  'h-7 rounded-md border border-white/10 bg-white/5 pr-2 pl-7 text-xs text-zinc-200 placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:outline-none'

export const consoleIconButtonClass =
  'text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:text-zinc-600'
