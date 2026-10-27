import {
  CaretRightOutlined,
  PauseOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Flex, Row, Space, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { lifecycleDeploy, listNodes, type ContainerInfo, type NodeItem } from '../api/deploy'
import { PageHeader } from '../components/PageHeader'

function memText(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function isUp(status: string) {
  return status.toLowerCase().includes('up')
}

function serviceNameOf(containerName: string) {
  return containerName.replace(/^cc-/, '')
}

function Meter({ percent, label }: { percent: number | null; label: string }) {
  const color = percent == null ? '#d9d9d9' : percent >= 85 ? '#ff4d4f' : percent >= 70 ? '#faad14' : '#52c41a'
  return (
    <Flex vertical gap={4} style={{ minWidth: 120 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label} {percent == null ? '未上报' : `${percent}%`}
      </Typography.Text>
      <div className="meter-bar">
        <div className="meter-fill" style={{ width: `${percent ?? 0}%`, background: color }} />
      </div>
    </Flex>
  )
}

export function NodesPage() {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState<string>()
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

  const onLifecycle = (node: NodeItem, c: ContainerInfo, action: 'start' | 'stop' | 'restart') => {
    const svc = serviceNameOf(c.name)
    const label = action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'
    modal.confirm({
      title: `${label} ${c.name} @ ${node.nodeId}？`,
      content: '由该节点 deploy-agent 执行 docker 操作，约 10 秒内心跳后生效。',
      okText: label,
      onOk: async () => {
        const key = `${node.nodeId}:${c.name}:${action}`
        setActing(key)
        try {
          const res = await lifecycleDeploy(node.nodeId, svc, action)
          message.success(`已下发任务 #${res.jobId}`)
          await reload()
        } finally {
          setActing(undefined)
        }
      },
    })
  }

  return (
    <>
      <PageHeader
        title="节点"
        description=""
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
        }
      />
      {rows.length === 0 ? (
        <Alert
          className="mb-4"
          type="info"
          showIcon
          title="还没有节点上报"
          description="在目标机器上运行 deploy-agent（agent.server 指向配置中心，agent.token 与 auth.agentToken 一致），心跳 10 秒一次。"
        />
      ) : online === 0 ? (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          title="全部节点离线"
          description="Agent 进程可能已停止；恢复运行后约 10 秒内回到在线。"
        />
      ) : null}
      <Row gutter={[16, 16]}>
        {rows.map((n) => {
          const cpuPct = (n.cpuUsedPercent ?? -1) >= 0 ? Math.round(n.cpuUsedPercent ?? 0) : null
          const memPct =
            n.memoryBytes > 0 && (n.memoryUsedBytes ?? -1) >= 0
              ? Math.round(((n.memoryUsedBytes ?? 0) / n.memoryBytes) * 100)
              : null
          return (
            <Col xs={24} md={12} xl={8} key={n.nodeId}>
              <Card
                size="small"
                title={
                  <Flex align="center" gap={8}>
                    <span className={`status-dot ${n.online ? 'ok' : 'bad'}`} />
                    <Typography.Text strong>{n.nodeId}</Typography.Text>
                    {!n.online ? <Tag>离线</Tag> : null}
                  </Flex>
                }
                extra={
                  <Tooltip title={`心跳 ${n.lastSeen || '-'} · agent ${n.agentVersion || '-'}`}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {n.online ? `agent ${n.agentVersion || '-'}` : '离线'}
                    </Typography.Text>
                  </Tooltip>
                }
              >
                <Flex vertical gap={12}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {n.hostname || '-'} · {n.os}/{n.arch} · docker {n.dockerPlatform || '-'}
                  </Typography.Text>
                  <Flex gap={16}>
                    <Meter percent={cpuPct} label="CPU" />
                    <Meter percent={memPct} label="内存" />
                  </Flex>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    内存 {memText(n.memoryBytes)} · 已用{' '}
                    {(n.memoryUsedBytes ?? -1) >= 0 ? memText(n.memoryUsedBytes ?? 0) : '未上报'}
                  </Typography.Text>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      本中心容器（{(n.containers ?? []).length}）
                    </Typography.Text>
                    {(n.containers ?? []).length === 0 ? (
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 4 }}>
                        暂无；去「发布」页发布一个服务
                      </Typography.Paragraph>
                    ) : (
                      <Flex vertical gap={4} style={{ marginTop: 6 }}>
                        {(n.containers ?? []).map((c: ContainerInfo) => {
                          const up = isUp(c.status)
                          const busy = acting?.startsWith(`${n.nodeId}:${c.name}:`)
                          return (
                            <Flex
                              key={c.name}
                              align="center"
                              gap={8}
                              wrap="wrap"
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                background: '#fafafa',
                              }}
                            >
                              <Tag color={up ? 'success' : 'default'}>{up ? '运行中' : '停止'}</Tag>
                              <Typography.Text strong style={{ fontSize: 13 }} ellipsis>
                                {c.name}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                                {c.image}
                              </Typography.Text>
                              <Space size={2} style={{ marginLeft: 'auto' }}>
                                <Tooltip title="启动">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<CaretRightOutlined />}
                                    disabled={!n.online || up || busy}
                                    onClick={() => onLifecycle(n, c, 'start')}
                                  />
                                </Tooltip>
                                <Tooltip title="停止">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<PauseOutlined />}
                                    disabled={!n.online || !up || busy}
                                    onClick={() => onLifecycle(n, c, 'stop')}
                                  />
                                </Tooltip>
                                <Tooltip title="重启">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<ThunderboltOutlined />}
                                    disabled={!n.online || busy}
                                    onClick={() => onLifecycle(n, c, 'restart')}
                                  />
                                </Tooltip>
                              </Space>
                            </Flex>
                          )
                        })}
                      </Flex>
                    )}
                  </div>
                </Flex>
              </Card>
            </Col>
          )
        })}
      </Row>
      {rows.length > 0 ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          在线 {online} / {rows.length} · 每 10 秒自动刷新
        </Typography.Text>
      ) : null}
    </>
  )
}
