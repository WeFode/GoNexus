import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Code2Icon,
  DatabaseIcon,
  EyeIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AuditMeta, ConfigItem } from '../api/config'
import { ConfigEditorDialog, type ConfigEditorValues } from '../components/ConfigEditorDialog'
import { useConfirm } from '../components/ConfirmProvider'
import { CopyButton } from '../components/CopyButton'
import { EmptyState } from '../components/EmptyState'
import { HistorySheet } from '../components/HistorySheet'
import { InlineAlert } from '../components/InlineAlert'
import { LoadingButton } from '../components/LoadingButton'
import { OnboardSheet } from '../components/OnboardSheet'
import { PageHeader } from '../components/PageHeader'
import { SearchInput } from '../components/SearchInput'
import { ToneBadge } from '../components/ToneBadge'
import { YamlView } from '../components/YamlEditor'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Skeleton } from '../components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { notifyError } from '../lib/notify'
import { SERVICE_DEFAULT_YAML } from '../onboard/snippets'

export type ConfigKind = 'shared' | 'services'

interface Props {
  kind: ConfigKind
  list: () => Promise<ConfigItem[]>
  /** 服务名列表，用于公共配置的影响面提示 */
  listServiceNames?: () => Promise<string[]>
  save: (key: string, content: string, meta?: AuditMeta) => Promise<unknown>
  remove: (key: string, meta?: AuditMeta) => Promise<unknown>
  preview?: (key: string) => Promise<{ name: string; content: string }>
}

export function ConfigListPage({ kind, list, listServiceNames, save, remove, preview }: Props) {
  const confirm = useConfirm()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ConfigItem[]>([])
  const [serviceNames, setServiceNames] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ConfigItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const [previewName, setPreviewName] = useState('')
  const [historyRow, setHistoryRow] = useState<ConfigItem | null>(null)
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [onboardName, setOnboardName] = useState('')

  const isService = kind === 'services'
  const keyLabel = isService ? '服务名' : '配置名'
  const title = isService ? '服务配置' : '公共配置'

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [items, names] = await Promise.all([
        list(),
        listServiceNames ? listServiceNames() : Promise.resolve<string[]>([]),
      ])
      setRows(items)
      setServiceNames(names)
    } catch (error) {
      notifyError(error, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [list, listServiceNames])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(
    () => rows.filter((row) => row.key.toLowerCase().includes(keyword.trim().toLowerCase())),
    [rows, keyword],
  )

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  const openEdit = (row: ConfigItem) => {
    setEditing(row)
    setEditorOpen(true)
  }

  const onSubmit = async (values: ConfigEditorValues) => {
    setSubmitting(true)
    try {
      const key = values.key.trim()
      const isCreate = !editing
      await save(key, values.content, { remark: values.remark })
      toast.success(
        isService ? `已保存，${key} 将在 1 秒内热加载` : `已保存，${serviceNames.length} 个服务将陆续热加载`,
      )
      setEditorOpen(false)
      await reload()
      if (isService && isCreate) {
        setOnboardName(key)
        setOnboardOpen(true)
      }
    } catch (error) {
      notifyError(error, '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = (row: ConfigItem) => {
    void confirm({
      title: `删除${keyLabel}「${row.key}」？`,
      description: isService
        ? '该服务热加载将得到「key 不存在」，本地快照兜底仍可运行。删除原因会写入审计历史。'
        : `全部 ${serviceNames.length} 个服务的合并配置中将失去此段内容。删除原因会写入审计历史。`,
      destructive: true,
      confirmText: '删除',
      reason: { label: '删除原因', placeholder: '例如：服务已下线', required: true },
      onConfirm: async (reason) => {
        await remove(row.key, { remark: reason })
        toast.success('已删除')
        await reload()
      },
    })
  }

  const onPreview = async (row: ConfigItem) => {
    if (!preview) return
    try {
      const res = await preview(row.key)
      setPreviewName(res.name)
      setPreviewText(res.content)
      setPreviewOpen(true)
    } catch (error) {
      notifyError(error, '预览失败')
    }
  }

  const showSkeleton = loading && rows.length === 0
  const showEmpty = !loading && filtered.length === 0

  return (
    <>
      <PageHeader
        title={title}
        description={
          isService ? '各微服务专属配置，保存后该服务 1 秒内热加载' : '所有微服务启动时合并，变更热推送至全部服务'
        }
        extra={
          <>
            <SearchInput
              value={keyword}
              onChange={setKeyword}
              placeholder={`搜索${keyLabel}`}
              className="w-full sm:w-56"
            />
            <LoadingButton variant="outline" loading={loading} onClick={() => void reload()}>
              <RefreshCwIcon />
              刷新
            </LoadingButton>
            {isService ? (
              <Button
                variant="outline"
                onClick={() => {
                  setOnboardName('')
                  setOnboardOpen(true)
                }}
              >
                <Code2Icon />
                接入指引
              </Button>
            ) : null}
            <Button onClick={openCreate}>
              <PlusIcon />
              新建{keyLabel}
            </Button>
          </>
        }
      />

      {!isService && serviceNames.length > 0 ? (
        <InlineAlert
          tone="warning"
          className="mb-4"
          icon={<ZapIcon />}
          title={
            <>
              公共配置变更将<span className="font-semibold">热推送至全部 {serviceNames.length} 个服务</span>
            </>
          }
          description="watch 1 秒内生效；数据库 / Redis 连接类变更建议结合服务重启"
          action={
            <div className="flex flex-wrap justify-end gap-1">
              {serviceNames.slice(0, 4).map((name) => (
                <ToneBadge key={name} tone="neutral">
                  {name}
                </ToneBadge>
              ))}
              {serviceNames.length > 4 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <ToneBadge tone="neutral">+{serviceNames.length - 4}</ToneBadge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">{serviceNames.slice(4).join(' · ')}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          }
        />
      ) : null}

      {showSkeleton ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="bg-card space-y-3 rounded-lg border p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <div className="bg-card rounded-lg border">
          <EmptyState
            icon={<DatabaseIcon />}
            title={
              rows.length === 0
                ? `还没有${keyLabel}${isService ? '，新建后可复制 GoFrame 接入代码' : ''}`
                : `没有匹配「${keyword}」的${keyLabel}`
            }
            hint={rows.length === 0 ? (isService ? '一个服务一份 YAML，公共段放「公共配置」' : '公共段对所有服务生效') : '试试换个关键字，或清空搜索'}
            action={
              rows.length === 0 ? (
                <Button size="sm" onClick={openCreate}>
                  <PlusIcon />
                  新建{keyLabel}
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((row) => (
            <Card key={row.fullKey} className="gap-0 overflow-hidden py-0">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <span className="truncate text-sm font-semibold" title={row.key}>
                  {row.key}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <ToneBadge tone="neutral" className="text-[11px] tabular-nums">
                        r{row.revision}
                      </ToneBadge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>etcd revision {row.revision}</TooltipContent>
                </Tooltip>
                <div className="ml-auto flex items-center">
                  <CopyButton value={row.fullKey} label={`复制完整键 ${row.fullKey}`} />
                </div>
              </div>

              <div className="flex-1 px-3 py-3">
                <YamlView
                  value={row.content}
                  maxHeight={180}
                  className="border-0 bg-transparent px-0 py-0"
                />
              </div>

              <div className="flex items-center gap-1 border-t px-2 py-1.5">
                <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                  <PencilIcon />
                  编辑
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setHistoryRow(row)}>
                  <HistoryIcon />
                  历史
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="更多操作">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {preview ? (
                      <DropdownMenuItem onSelect={() => void onPreview(row)}>
                        <EyeIcon />
                        预览合并配置
                      </DropdownMenuItem>
                    ) : null}
                    {isService ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setOnboardName(row.key)
                          setOnboardOpen(true)
                        }}
                      >
                        <Code2Icon />
                        接入代码
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
                      <Trash2Icon />
                      删除{keyLabel}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfigEditorDialog
        open={editorOpen}
        title={editing ? `编辑 ${editing.key}` : `新建${keyLabel}`}
        keyLabel={keyLabel}
        keyPlaceholder={isService ? 'shop-server' : 'database'}
        keyDisabled={Boolean(editing)}
        initial={editing ? { key: editing.key, content: editing.content } : undefined}
        defaultContent={isService && !editing ? SERVICE_DEFAULT_YAML : undefined}
        submitting={submitting}
        impact={
          isService
            ? { kind: 'service', serviceCount: 1, serviceName: editing?.key }
            : { kind: 'shared', serviceCount: serviceNames.length }
        }
        onCancel={() => setEditorOpen(false)}
        onSubmit={(values) => void onSubmit(values)}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>合并预览 · {previewName}</DialogTitle>
            <DialogDescription>公共配置 + 服务配置合并后的最终生效内容（服务视角）。</DialogDescription>
          </DialogHeader>
          <YamlView value={previewText} maxHeight={460} />
          <DialogFooter>
            <CopyButton value={previewText} label="复制合并结果" size="icon-sm" />
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {historyRow ? (
        <HistorySheet
          kind={kind}
          configKey={historyRow.key}
          current={historyRow.content}
          open
          onClose={() => setHistoryRow(null)}
          onRolledBack={() => {
            setHistoryRow(null)
            void reload()
          }}
        />
      ) : null}

      {isService ? <OnboardSheet open={onboardOpen} serviceName={onboardName} onClose={() => setOnboardOpen(false)} /> : null}
    </>
  )
}
