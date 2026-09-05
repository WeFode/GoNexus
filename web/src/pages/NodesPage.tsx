import { Alert, App, Button, Empty, Flex, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { listNodes, type ContainerInfo, type NodeItem } from '../api/deploy'
import { PageHeader } from '../components/PageHeader'

function mem(n: number) {
  if (!n) return '-'
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function NodesPage() {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<NodeItem[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listNodes())
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 10000)
    return () => clearInterval(t)
  }, [reload])

  const online = rows.filter((r) => r.online).length

  const columns: TableProps<NodeItem>['columns'] = [
    { title: '节点', dataIndex: 'nodeId', width: 140, render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
    { title: '主机', dataIndex: 'hostname', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'online',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '在线' : '离线'}</Tag>,
    },
    { title: 'OS', width: 110, render: (_, r) => `${r.os}/${r.arch}` },
    { title: 'Docker', dataIndex: 'dockerPlatform', width: 130 },
    { title: 'CPU', dataIndex: 'ncpu', width: 70 },
    { title: '内存', dataIndex: 'memoryBytes', width: 90, render: mem },
    { title: '心跳', dataIndex: 'lastSeen', width: 180 },
    { title: 'Agent', dataIndex: 'agentVersion', width: 80 },
  ]

  return (
    <>
      <PageHeader
        title="节点"
        description="每台机器一个 deploy-agent。只展示本中心发布的容器（名称 cc-<服务名>）。"
        extra={
          <Button onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
        }
      />
      {rows.length === 0 ? (
        <Alert
          className="mb-4"
          type="info"
          showIcon
          message="还没有节点上报"
          description="在 Windows 或 Linux 节点上：cd deploy-agent && go run . 配置 agent.server 指向配置中心，agent.token 与 auth.agentToken 一致。"
        />
      ) : online === 0 ? (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message="全部节点离线"
          description="Agent 进程已停止。重新 go run . 或做成系统服务后，约 10 秒内会恢复在线。"
        />
      ) : null}
      <Table<NodeItem>
        rowKey="nodeId"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <Empty description="等待 Agent 心跳" /> }}
        expandable={{
          expandedRowRender: (row) => (
            <Flex vertical gap={4}>
              {(row.containers ?? []).length === 0 ? (
                <Typography.Text type="secondary">该节点暂无本中心发布的容器</Typography.Text>
              ) : (
                (row.containers ?? []).map((c: ContainerInfo) => (
                  <Typography.Text key={c.name}>
                    <Tag color={c.status.toLowerCase().includes('up') ? 'success' : 'default'}>{c.status}</Tag>
                    {c.name} · {c.image} · {c.ports || '无端口'}
                  </Typography.Text>
                ))
              )}
            </Flex>
          ),
        }}
      />
    </>
  )
}
