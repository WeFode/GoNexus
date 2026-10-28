import { useCallback, useEffect, useRef, useState } from 'react'
import { getObservabilityServices, listLogs, logStreamUrl, type LogItem, type ServiceItem } from '../api/observability'
import { notifyError } from '../lib/notify'

export type ConnState = 'connecting' | 'live' | 'paused' | 'error'

interface Options {
  /** 首屏拉取条数 */
  limit?: number
  /** 前端保留的最大条数，超出丢弃最旧的 */
  maxItems?: number
  /** 服务日志页需要每 5 秒刷新一次侧栏服务列表 */
  pollServices?: boolean
}

/** SSE 日志流：首屏补齐 → 实时追加 → 暂停/继续 → 只保留最近 N 条 */
export function useLogStream({ limit = 300, maxItems = 1200, pollServices = false }: Options = {}) {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [services, setServices] = useState<ServiceItem[]>([])
  const [live, setLive] = useState(true)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [stick, setStick] = useState(true)
  const lastIdRef = useRef(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    listLogs(limit)
      .then((res) => {
        if (cancelled) return
        setLogs(res.items ?? [])
        setSources(res.sources ?? [])
        setServices(res.services ?? [])
        lastIdRef.current = res.lastId || 0
        setStick(true)
      })
      .catch((error) => {
        if (!cancelled) notifyError(error, '日志加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [limit])

  useEffect(() => {
    if (!pollServices) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await getObservabilityServices()
        if (!cancelled) setServices(res.items ?? [])
      } catch {
        /* 侧栏刷新失败不打断日志流 */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pollServices])

  useEffect(() => {
    if (!live) {
      setConn('paused')
      return
    }
    setConn('connecting')
    const source = new EventSource(logStreamUrl(lastIdRef.current))
    source.onopen = () => setConn('live')
    source.onmessage = (event) => {
      let item: LogItem
      try {
        item = JSON.parse(event.data) as LogItem
      } catch {
        return
      }
      if (!item?.id || item.id <= lastIdRef.current) return
      lastIdRef.current = item.id
      setConn('live')
      setLogs((prev) => {
        const next = prev.concat(item)
        return next.length > maxItems ? next.slice(next.length - maxItems) : next
      })
      if (item.service) {
        setServices((prev) => {
          const index = prev.findIndex((service) => service.name === item.service)
          if (index < 0) {
            return [...prev, { name: item.service!, count: 1, lastTs: item.ts, seenAt: Date.now() }]
          }
          const next = [...prev]
          next[index] = {
            ...next[index],
            count: next[index].count + 1,
            lastTs: item.ts,
            seenAt: Date.now(),
          }
          return next
        })
      }
    }
    source.onerror = () => {
      setConn(source.readyState === EventSource.CLOSED ? 'error' : 'connecting')
    }
    return () => source.close()
  }, [live, maxItems])

  useEffect(() => {
    if (!stick) return
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length, stick])

  const handleScroll = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }, [])

  const jumpLatest = useCallback(() => {
    setStick(true)
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  return {
    logs,
    setLogs,
    sources,
    services,
    live,
    setLive,
    conn,
    stick,
    boxRef,
    handleScroll,
    jumpLatest,
  }
}
