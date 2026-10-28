import { useEffect, useState } from 'react'
import { ZapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineAlert } from './InlineAlert'
import { LoadingButton } from './LoadingButton'
import { YamlEditor } from './YamlEditor'

export interface ConfigEditorValues {
  key: string
  content: string
  remark: string
}

interface Props {
  open: boolean
  title: string
  keyLabel: string
  keyPlaceholder: string
  submitting?: boolean
  initial?: Partial<ConfigEditorValues>
  keyDisabled?: boolean
  defaultContent?: string
  /** 影响面提示：shared=公共配置将热推送至全部服务；service=仅该服务热加载 */
  impact?: { kind: 'shared' | 'service'; serviceCount: number; serviceName?: string }
  onCancel: () => void
  onSubmit: (values: ConfigEditorValues) => void
}

interface FieldErrors {
  key?: string
  content?: string
  remark?: string
}

export function ConfigEditorDialog({
  open,
  title,
  keyLabel,
  keyPlaceholder,
  submitting,
  initial,
  keyDisabled,
  defaultContent,
  impact,
  onCancel,
  onSubmit,
}: Props) {
  const [key, setKey] = useState('')
  const [content, setContent] = useState('')
  const [remark, setRemark] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})

  // 只在打开时回填一次，避免父组件轮询刷新把用户正在输入的内容冲掉
  useEffect(() => {
    if (!open) return
    setKey(initial?.key ?? '')
    setContent(initial?.content ?? defaultContent ?? '')
    setRemark('')
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = () => {
    const next: FieldErrors = {}
    if (!key.trim()) next.key = `请输入${keyLabel}`
    if (!remark.trim()) next.remark = '请填写变更说明（写入审计历史）'
    if (!content.trim()) next.content = '请输入 YAML 内容'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSubmit({ key: key.trim(), content, remark: remark.trim() })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    // 单行输入里直接回车提交；textarea 里的回车仍然是换行
    if (event.key === 'Enter' && !event.shiftKey && (event.target as HTMLElement).tagName === 'INPUT') {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onCancel()
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>保存后由 etcd watch 推送，服务无需重启。Ctrl / Cmd + Enter 快速提交。</DialogDescription>
        </DialogHeader>

        {impact?.kind === 'shared' ? (
          <InlineAlert
            tone="warning"
            icon={<ZapIcon />}
            title="公共配置：保存后立即热推送"
            description={`全部 ${impact.serviceCount} 个已接入服务将在 1 秒内重新加载配置。请确认变更影响范围。`}
          />
        ) : impact?.kind === 'service' && initial?.key ? (
          <InlineAlert
            tone="info"
            icon={<ZapIcon />}
            title="服务配置：仅此服务热加载"
            description={`${impact.serviceName ?? '该服务'} 会在 1 秒内重新加载，其他服务不受影响。`}
          />
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="config-key">{keyLabel}</Label>
          <Input
            id="config-key"
            value={key}
            placeholder={keyPlaceholder}
            disabled={keyDisabled}
            aria-invalid={Boolean(errors.key)}
            onChange={(event) => {
              setKey(event.target.value)
              if (errors.key) setErrors((prev) => ({ ...prev, key: undefined }))
            }}
          />
          {errors.key ? <p className="text-destructive text-xs">{errors.key}</p> : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="config-remark">变更说明</Label>
            <span className="text-muted-foreground text-xs">会写入审计历史，回滚时靠它判断版本</span>
          </div>
          <Input
            id="config-remark"
            value={remark}
            maxLength={200}
            placeholder="例如：双十一调大连接池"
            aria-invalid={Boolean(errors.remark)}
            onChange={(event) => {
              setRemark(event.target.value)
              if (errors.remark) setErrors((prev) => ({ ...prev, remark: undefined }))
            }}
          />
          {errors.remark ? <p className="text-destructive text-xs">{errors.remark}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="config-content">YAML</Label>
          <YamlEditor
            id="config-content"
            value={content}
            placeholder={'server:\n  address: ":8000"'}
            aria-invalid={Boolean(errors.content)}
            onChange={(event) => {
              setContent(event.target.value)
              if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }))
            }}
          />
          {errors.content ? <p className="text-destructive text-xs">{errors.content}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onCancel}>
            取消
          </Button>
          <LoadingButton loading={submitting} onClick={submit}>
            保存并热推送
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
