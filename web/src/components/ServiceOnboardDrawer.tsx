import { Alert, Drawer, Steps, Typography } from 'antd'
import { catalogSnippet, cmdSnippet, goModSnippet, localConfigYaml } from '../onboard/snippets'

interface Props {
  open: boolean
  serviceName?: string
  onClose: () => void
}

function CopyBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="mb-4">
      <Typography.Text type="secondary">{title}</Typography.Text>
      <Typography.Paragraph copyable={{ text: value }} className="mt-1 mb-0">
        <pre className="m-0 whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[13px]">{value}</pre>
      </Typography.Paragraph>
    </div>
  )
}

export function ServiceOnboardDrawer({ open, serviceName, onClose }: Props) {
  const name = serviceName?.trim() || 'your-service'
  return (
    <Drawer title={`GoFrame 接入 · ${name}`} open={open} onClose={onClose} size={560}>
      <Alert
        className="mb-4"
        type="info"
        showIcon
        message="业务代码不用改 g.Cfg().Get。服务名必须与 @ 后缀、本页 key、打包 catalog.name 相同。"
      />
      <Steps
        direction="vertical"
        current={-1}
        items={[
          { title: '本地只留 etcd 入口', description: 'manifest/config/config.yaml' },
          { title: 'cmd 里 Boot + BindHealth', description: '不要放 init()，否则 go test 会连 etcd' },
          { title: '本页已登记服务 YAML', description: '公共 database/redis 放「公共配置」' },
        ]}
      />
      <CopyBlock title="config.yaml" value={localConfigYaml(name)} />
      <CopyBlock title="go.mod" value={goModSnippet()} />
      <CopyBlock title="internal/cmd/cmd.go（节选）" value={cmdSnippet()} />
      <CopyBlock title="deploy/catalog.json（可选，用于中台发布）" value={catalogSnippet(name)} />
      <Typography.Text type="secondary">
        启动后 GET /api/v1/health，configFrom 为 etcd 即接入成功。完整说明见仓库 examples/gf-service。
      </Typography.Text>
    </Drawer>
  )
}
