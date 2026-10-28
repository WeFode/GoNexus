import { useEffect, useMemo, useState } from 'react'
import { HistoryIcon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { listHistory, rollbackConfig, type HistoryItem } from '@/api/config'
import { CopyButton } from './CopyButton'
import { useConfirm } from './ConfirmProvider'
import { EmptyState } from './EmptyState'
import { ToneBadge } from './ToneBadge'
import { YamlView } from './YamlEditor'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { notifyError } from '@/lib/notify'
import type { Tone } from './IconTile'

interface Props {
  kind: 'shared' | 'services'
  configKey: string
  current: string
  open: boolean
  onClose: () => void
  onRolledBack: () => void
}

const actionTone: Record<string, Tone> = {
  CREATE: 'info',
  UPDATE: 'info',
  BASELINE: 'warning',
  DELETE: 'danger',
  ROLLBACK: 'success',
}

export function HistorySheet({ kind, configKey, current, open, onClose, onRolledBack }: Props) {
  const confirm = useConfirm()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<HistoryItem[]>([])
  const [selected, setSelected] = useState<HistoryItem | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSelected(null)
    setLoading(true)
    listHistory(kind, configKey)
      .then((list) => {
        if (cancelled) return
        setRows(list)
        setSelected(list.find((row) => row.content !== current) ?? list[0] ?? null)
      })
      .catch((error) => {
        if (!cancelled) notifyError(error, '加载历史失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, kind, configKey, current])

  const previous = useMemo(() => rows.find((row) => row.content !== current), [rows, current])

  const onRollback = (row: HistoryItem) => {
    if (row.content === current) {
      toast.warning('该版本已是当前配置')
      return
    }
    void confirm({
      title: `回滚到版本 v${row.version}？`,
      description: '将把该版本 YAML 作为一次新发布写入 etcd。历史记录保留，不会覆盖或删除旧行。',
      confirmText: '回滚',
      onConfirm: async () => {
        const res = await rollbackConfig(kind, configKey, row.version, {
          remark: `回滚至版本 ${row.version}`,
        })
        toast.success(`已发布为版本 v${res.version}`)
        onRolledBack()
      },
    })
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-5xl">
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b px-5 py-4 pr-12">
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">历史 · {configKey}</SheetTitle>
            <SheetDescription className="mt-1 text-xs leading-5">
              每次保存会把「修改前」的 YAML 补进历史；回滚是一次新发布，不会删掉任何历史行。
            </SheetDescription>
          </div>
          {previous ? (
            <Button size="sm" className="shrink-0" onClick={() => onRollback(previous)}>
              <Undo2Icon />
              回滚到上一版
            </Button>
          ) : null}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-5/6" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<HistoryIcon />}
              title="暂无历史版本"
              hint="保存一次配置后，这里会出现可回滚的版本记录。"
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-14 pl-4">版本</TableHead>
                      <TableHead className="w-24">操作</TableHead>
                      <TableHead className="w-28">操作人</TableHead>
                      <TableHead>说明</TableHead>
                      <TableHead className="w-44">时间</TableHead>
                      <TableHead className="w-20 pr-4 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const active = selected?.id === row.id
                      return (
                        <TableRow
                          key={row.id}
                          data-state={active ? 'selected' : undefined}
                          className="cursor-pointer"
                          onClick={() => setSelected(row)}
                        >
                          <TableCell className="pl-4 font-mono text-xs tabular-nums">v{row.version}</TableCell>
                          <TableCell>
                            <ToneBadge tone={actionTone[row.actionType] ?? 'neutral'}>{row.actionType}</ToneBadge>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-28 truncate text-xs">
                            {row.operator || '-'}
                          </TableCell>
                          <TableCell className="max-w-0">
                            <span className="block truncate text-[13px]" title={row.remark}>
                              {row.remark || '-'}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs tabular-nums">
                            {row.createdAt || '-'}
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            {row.content === current ? (
                              <span className="text-muted-foreground text-xs">当前</span>
                            ) : (
                              <Button
                                variant="link"
                                size="xs"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onRollback(row)
                                }}
                              >
                                回滚
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex h-7 items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">当前 etcd</span>
                    <CopyButton value={current} label="复制当前配置" />
                  </div>
                  <YamlView value={current} maxHeight={320} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex h-7 items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      选中版本 {selected ? <span className="tabular-nums">v{selected.version}</span> : '-'}
                    </span>
                    {selected ? <CopyButton value={selected.content} label="复制选中版本" /> : null}
                  </div>
                  <YamlView value={selected?.content ?? ''} maxHeight={320} />
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
