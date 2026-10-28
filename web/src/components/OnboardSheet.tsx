import { Code2Icon } from 'lucide-react'
import { CopyButton } from './CopyButton'
import { InlineAlert } from './InlineAlert'
import { YamlView } from './YamlEditor'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { catalogSnippet, cmdSnippet, goModSnippet, localConfigYaml } from '../onboard/snippets'

interface Props {
  open: boolean
  serviceName?: string
  onClose: () => void
}

const steps = [
  { title: '本地只留 etcd 入口', desc: 'manifest/config/config.yaml' },
  { title: 'cmd 里 Boot + BindHealth', desc: '不要放 init()，否则 go test 会连 etcd' },
  { title: '在「服务配置」登记同名的服务 YAML', desc: '公共 database/redis 放「公共配置」' },
]

function CopyBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex h-7 items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{title}</span>
        <CopyButton value={value} label={`复制 ${title}`} />
      </div>
      <YamlView value={value} maxHeight={300} />
    </div>
  )
}

export function OnboardSheet({ open, serviceName, onClose }: Props) {
  const name = serviceName?.trim() || 'your-service'

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Code2Icon className="size-4" />
            GoFrame 接入 · {name}
          </SheetTitle>
          <SheetDescription className="text-xs">业务代码不用改 g.Cfg().Get，服务名与 key、catalog.name 保持一致即可。</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <InlineAlert
            tone="info"
            title="服务名必须与 @ 后缀、本页 key、打包 catalog.name 相同"
            description="否则服务拉不到自己的配置段，只能读公共配置。"
          />

          <ol className="space-y-2.5">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-2.5">
                <span className="text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-5 font-medium">{step.title}</span>
                  <span className="text-muted-foreground block text-xs leading-5">{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>

          <CopyBlock title="config.yaml" value={localConfigYaml(name)} />
          <CopyBlock title="go.mod" value={goModSnippet()} />
          <CopyBlock title="internal/cmd/cmd.go（节选）" value={cmdSnippet()} />
          <CopyBlock title="deploy/catalog.json（可选，用于中台发布）" value={catalogSnippet(name)} />

          <p className="text-muted-foreground text-xs leading-5">
            启动后 GET /api/v1/health，configFrom 为 etcd 即接入成功。完整说明见仓库 examples/gf-service。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
