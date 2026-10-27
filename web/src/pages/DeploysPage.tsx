import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Input,
  InputNumber,
  List,
  Radio,
  Row,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  actionLabel,
  createDeploy,
  jobStatusLabel,
  listArtifacts,
  listDeployJobs,
  listNodes,
  parseJobSemantics,
  promoteDeploy,
  rollbackDeploy,
  uploadArtifact,
  type ArtifactItem,
  type DeployJobItem,
  type NodeItem,
} from '../api/deploy'
import { PageHeader } from '../components/PageHeader'
import { RecommendPanel } from '../components/RecommendPanel'

interface UploadTask {
  uid: string
  file: File
  serviceName: string
  imageName: string
  platform: string
  containerPort: number
  status: 'ready' | 'uploading' | 'done' | 'error'
  error?: string
  artifactId?: number
}

function guessMeta(name: string) {
  let serviceName = 'shop-server'
  let imageName = 'shop-server:linux-amd64'
  let platform = 'linux/amd64'
  let containerPort = 8000
  const m = name.match(/^(.+)-(linux-amd64|linux-arm64)\.tar$/i)
  if (m) {
    serviceName = m[1]
    platform = m[2].replace('-', '/')
    imageName = `${serviceName}:${m[2]}`
    containerPort = serviceName === 'configure-server' ? 9000 : 8000
  }
  return { serviceName, imageName, platform, containerPort }
}

function platformMatch(art: ArtifactItem | undefined, node: NodeItem) {
  if (!art?.platform || !node.dockerPlatform) return true
  return art.platform.replace('x86_64', 'amd64') === node.dockerPlatform.replace('x86_64', 'amd64')
}

function memText(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function DeploysPage() {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [nodes, setNodes] = useState<NodeItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([])
  const [jobs, setJobs] = useState<DeployJobItem[]>([])
  const [uploads, setUploads] = useState<UploadTask[]>([])
  const [uploading, setUploading] = useState(false)
  const [promoting, setPromoting] = useState(false)

  // 发布向导状态
  const [artifactId, setArtifactId] = useState<number>()
  const [nodeIds, setNodeIds] = useState<string[]>([])
  const [hostPort, setHostPort] = useState<number>()
  const [strategy, setStrategy] = useState<'canary' | 'all'>('canary')
  const [canaryCount, setCanaryCount] = useState(1)
  const [canaryHostPort, setCanaryHostPort] = useState<number>()
  const [remark, setRemark] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [n, a, j] = await Promise.all([listNodes(), listArtifacts(), listDeployJobs()])
      setNodes(n)
      setArtifacts(a)
      setJobs(j)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 6000)
    return () => clearInterval(t)
  }, [reload])

  const online = nodes.filter((n) => n.online)
  const selectedArt = artifacts.find((a) => a.id === artifactId)
  const selectedNodes = nodes.filter((n) => nodeIds.includes(n.nodeId))
  const mismatchNodes = selectedNodes.filter((n) => !platformMatch(selectedArt, n))
  const sidecarMode = strategy === 'canary' && nodeIds.length === 1 && Boolean(canaryHostPort)
  const effectivePort = hostPort || selectedArt?.containerPort || 8000

  const step = artifactId ? (nodeIds.length > 0 ? 2 : 1) : 0

  const waitingJobs = jobs.filter((j) => j.status === 'waiting')
  const waitingByArtifact = useMemo(() => {
    const map = new Map<number, DeployJobItem[]>()
    for (const j of waitingJobs) {
      const list = map.get(j.artifactId) ?? []
      list.push(j)
      map.set(j.artifactId, list)
    }
    return [...map.entries()]
  }, [waitingJobs])
  const sidecarReady = useMemo(() => {
    const seen = new Set<number>()
    const out: DeployJobItem[] = []
    for (const j of jobs) {
      if (j.action !== 'canary' || j.status !== 'success') continue
      if (jobs.some((x) => x.action === 'stop-canary' && x.artifactId === j.artifactId && x.id > j.id && x.status !== 'failed')) continue
      if (jobs.some((x) => x.action === 'deploy' && x.artifactId === j.artifactId && x.nodeId === j.nodeId && x.id > j.id && x.status === 'success')) continue
      if (jobs.some((x) => x.status === 'waiting' && x.artifactId === j.artifactId)) continue
      if (seen.has(j.artifactId)) continue
      seen.add(j.artifactId)
      out.push(j)
    }
    return out
  }, [jobs])

  // ============ 批量上传 ============
  const onPickFiles = (files: File[]) => {
    const tasks: UploadTask[] = files
      .filter((f) => /\.tar$/i.test(f.name))
      .map((f) => {
        const meta = guessMeta(f.name)
        return {
          uid: `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          ...meta,
          status: 'ready' as const,
        }
      })
    if (files.length !== tasks.length) {
      message.warning('已忽略非 .tar 文件')
    }
    if (tasks.length === 0) return
    setUploads((prev) => [...prev, ...tasks])
  }

  const uploadAll = async () => {
    const pend = uploads.filter((u) => u.status === 'ready' || u.status === 'error')
    if (pend.length === 0) {
      message.info('没有待上传的文件')
      return
    }
    setUploading(true)
    for (const t of pend) {
      setUploads((prev) => prev.map((u) => (u.uid === t.uid ? { ...u, status: 'uploading' } : u)))
      try {
        const art = await uploadArtifact(t.file, {
          serviceName: t.serviceName,
          imageName: t.imageName,
          platform: t.platform,
          containerPort: t.containerPort,
        })
        setUploads((prev) =>
          prev.map((u) => (u.uid === t.uid ? { ...u, status: 'done', artifactId: art.id, error: undefined } : u)),
        )
        if (!artifactId) {
          setArtifactId(art.id)
          setHostPort(art.containerPort)
        }
      } catch (e) {
        setUploads((prev) =>
          prev.map((u) =>
            u.uid === t.uid ? { ...u, status: 'error', error: e instanceof Error ? e.message : '上传失败' } : u,
          ),
        )
      }
    }
    setUploading(false)
    await reload()
    const ok = uploads.filter((u) => u.status === 'done').length
    if (ok > 0) message.success('上传完成，可在下方选择产物后选择节点发布')
  }

  const removeTask = (uid: string) => setUploads((prev) => prev.filter((u) => u.uid !== uid))

  // ============ 发布 ============
  const toggleNode = (nodeId: string) => {
    setNodeIds((prev) => (prev.includes(nodeId) ? prev.filter((i) => i !== nodeId) : [...prev, nodeId]))
  }

  const confirmDeploy = (ids: string[]) => {
    if (ids.length === 0 || !artifactId) {
      message.warning('请先选择产物和节点')
      return
    }
    if (mismatchNodes.length > 0) {
      message.error(`产物平台 ${selectedArt?.platform} 与 ${mismatchNodes.map((n) => n.nodeId).join(',')} 的架构不一致`)
      return
    }
    if (sidecarMode && canaryHostPort === effectivePort) {
      message.warning('灰度端口不能与主端口相同')
      return
    }
    const art = artifacts.find((a) => a.id === artifactId)
    const names = ids.join('、')
    let content = ''
    if (strategy === 'all') {
      content = `将同时替换 ${ids.length} 台节点上的主容器。`
    } else if (sidecarMode) {
      content = `旧容器保持运行；新版本以 cc-${art?.serviceName}-canary 监听 ${canaryHostPort}，确认后再「转正」。`
    } else if (ids.length === 1) {
      content = '发布到该节点并替换主容器。'
    } else {
      content = `先发前 ${Math.min(canaryCount, ids.length)} 台，其余 ${ids.length - Math.min(canaryCount, ids.length)} 台等待推进。`
    }
    modal.confirm({
      title: `发布 ${art?.serviceName} → ${names}？`,
      content: (
        <Flex vertical gap={4}>
          <Typography.Text>镜像 {art?.imageName}，主端口 {effectivePort}。{content}</Typography.Text>
          <Typography.Text type="secondary">
            发布后自动探测健康（/api/v1/health），失败自动回滚旧镜像。
          </Typography.Text>
        </Flex>
      ),
      okText: '确认发布',
      onOk: async () => {
        const res = await createDeploy({
          nodeIds: ids,
          artifactId,
          hostPort,
          remark,
          strategy,
          canaryCount,
          canaryHostPort: sidecarMode ? canaryHostPort : undefined,
        })
        setNodeIds(ids)
        message.success(`已下发任务 #${res.jobIds.join('、#')}`)
        setRemark('')
        await reload()
      },
    })
  }

  const onRollback = (row: DeployJobItem) => {
    modal.confirm({
      title: `回滚 ${row.serviceName} @ ${row.nodeId}？`,
      content: '将上一成功版本重新发布为新任务（服务会照常执行健康检查）。历史全部保留。',
      okText: '回滚',
      onOk: async () => {
        const res = await rollbackDeploy(row.nodeId, row.serviceName)
        message.success(`已下发回滚任务 #${res.jobId}`)
        await reload()
      },
    })
  }

  const onPromote = (aid: number, title: string, content: string) => {
    modal.confirm({
      title,
      content,
      okText: '推进',
      onOk: async () => {
        setPromoting(true)
        try {
          const res = await promoteDeploy(aid)
          message.success(`已推进 #${res.jobIds.join('、#')}`)
          await reload()
        } finally {
          setPromoting(false)
        }
      },
    })
  }

  const artCols: TableProps<ArtifactItem>['columns'] = [
    {
      title: '',
      dataIndex: 'id',
      width: 44,
      render: (_: unknown, row: ArtifactItem) => (
        <Radio checked={artifactId === row.id} onChange={() => selectArtifact(row)} />
      ),
    },
    { title: '服务', dataIndex: 'serviceName', width: 140 },
    { title: '镜像', dataIndex: 'imageName', ellipsis: true },
    { title: '平台', dataIndex: 'platform', width: 120 },
    { title: '容器端口', dataIndex: 'containerPort', width: 90 },
    {
      title: '大小',
      dataIndex: 'fileSize',
      width: 90,
      render: (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`,
    },
    { title: '时间', dataIndex: 'createdAt', width: 170 },
  ]

  const selectArtifact = (row: ArtifactItem) => {
    setArtifactId(row.id)
    setHostPort(row.containerPort)
    setCanaryHostPort(undefined)
  }

  const jobCols: TableProps<DeployJobItem>['columns'] = [
    { title: '#', dataIndex: 'id', width: 64 },
    { title: '服务', dataIndex: 'serviceName', width: 130 },
    { title: '动作', dataIndex: 'action', width: 100, render: (v: string) => actionLabel(v) },
    { title: '节点', dataIndex: 'nodeId', width: 110, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 200,
      render: (_: unknown, row: DeployJobItem) => {
        const sem = parseJobSemantics(row)
        const color = row.status === 'success' ? 'success' : row.status === 'failed' ? 'error' : row.status === 'waiting' ? 'warning' : 'processing'
        return (
          <Space size={4} wrap>
            <Tag color={color}>{jobStatusLabel(row.status)}</Tag>
            {row.status === 'success' && sem.healthOk ? (
              <Tooltip title="发布后健康探测通过（/api/v1/health）">
                <Tag color="green" icon={<CheckCircleOutlined />}>健康</Tag>
              </Tooltip>
            ) : null}
            {row.status === 'failed' && sem.autoRolledBack ? (
              <Tooltip title="新版本健康检查失败，已自动恢复旧镜像">
                <Tag color="orange" icon={<SafetyOutlined />}>已自动回滚</Tag>
              </Tooltip>
            ) : null}
            {row.status === 'failed' && sem.noPrevious ? (
              <Tag color="default">无旧版本可回滚</Tag>
            ) : null}
          </Space>
        )
      },
    },
    { title: '说明', dataIndex: 'message', ellipsis: true },
    { title: '操作人', dataIndex: 'operator', width: 90, ellipsis: true },
    { title: '时间', dataIndex: 'updatedAt', width: 165 },
    {
      title: '',
      key: 'rb',
      width: 70,
      render: (_, row) =>
        row.status === 'success' && (row.action === 'deploy' || row.action === 'rollback') ? (
          <Button type="link" size="small" danger onClick={() => onRollback(row)}>
            回滚
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="发布"
        description=""
        extra={
          <Flex gap={8} align="center">
            <Badge count={jobs.filter((j) => ['pending', 'waiting', 'running'].includes(j.status)).length} size="small">
              <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
                刷新
              </Button>
            </Badge>
          </Flex>
        }
      />

      {online.length === 0 ? (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          title="没有在线节点"
          description="在目标机器启动 deploy-agent（心跳 10s 一次）后即可在此发布，无需逐台拷贝 tar。"
        />
      ) : null}

      <Steps
        size="small"
        current={step}
        items={[
          { title: '上传产物', icon: <CloudUploadOutlined /> },
          { title: '选择目标', icon: <NodeIndexOutlined /> },
          { title: '确认发布', icon: <RocketOutlined /> },
        ]}
        style={{ marginBottom: 20 }}
      />

      {/* Step 1 上传产物 */}
      <Card size="small" title="① 上传产物（支持批量，一次可传多个服务的 tar）" className="mb-4">
        <Row gutter={16}>
          <Col xs={24} md={10}>
            <Upload.Dragger
              multiple
              showUploadList={false}
              accept=".tar"
              beforeUpload={(_, fileList) => {
                onPickFiles(fileList as unknown as File[])
                return false
              }}
              style={{ padding: 8 }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽 tar 文件到此处</p>
              <p className="ant-upload-hint">
                命名 <code>服务名-linux-amd64.tar</code> 可自动识别元数据；例如 shop-server-linux-amd64.tar
              </p>
            </Upload.Dragger>
            <Flex gap={8} style={{ marginTop: 12 }}>
              <Button
                type="primary"
                block
                icon={<CloudUploadOutlined />}
                loading={uploading}
                disabled={uploads.filter((u) => u.status === 'ready' || u.status === 'error').length === 0}
                onClick={() => void uploadAll()}
              >
                上传 {uploads.filter((u) => u.status === 'ready' || u.status === 'error').length > 0
                  ? `（${uploads.filter((u) => u.status === 'ready' || u.status === 'error').length} 个待传）`
                  : ''}
              </Button>
              {uploads.length > 0 ? (
                <Button onClick={() => setUploads([])} disabled={uploading}>
                  清空队列
                </Button>
              ) : null}
            </Flex>
          </Col>
          <Col xs={24} md={14}>
            {uploads.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择文件" style={{ marginTop: 24 }} />
            ) : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <List
                  size="small"
                  dataSource={uploads}
                  rowKey="uid"
                  renderItem={(u) => (
                    <List.Item
                      actions={
                        u.status !== 'uploading'
                          ? [
                              u.status === 'error' ? (
                                <Button key="retry" type="link" size="small" onClick={() => void uploadAll()}>
                                  重试
                                </Button>
                              ) : null,
                              <Button key="del" type="link" size="small" danger onClick={() => removeTask(u.uid)}>
                                移除
                              </Button>,
                            ].filter(Boolean)
                          : undefined
                      }
                    >
                      <List.Item.Meta
                        avatar={
                          u.status === 'uploading' ? (
                            <Typography.Text type="secondary">…</Typography.Text>
                          ) : u.status === 'done' ? (
                            <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          ) : u.status === 'error' ? (
                            <Typography.Text type="danger">!</Typography.Text>
                          ) : (
                            <InboxOutlined style={{ color: '#bfbfbf' }} />
                          )
                        }
                        title={
                          <Flex align="center" gap={8} wrap="wrap">
                            <Typography.Text strong ellipsis style={{ maxWidth: 240 }}>
                              {u.file.name}
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {u.serviceName} · {u.platform} · 端口 {u.containerPort}
                            </Typography.Text>
                          </Flex>
                        }
                        description={
                          <Flex gap={8} wrap="wrap">
                            <Input
                              size="small"
                              style={{ width: 130 }}
                              prefix="服务"
                              value={u.serviceName}
                              onChange={(e) =>
                                setUploads((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, serviceName: e.target.value } : x)))
                              }
                              disabled={u.status === 'uploading' || u.status === 'done'}
                            />
                            <Input
                              size="small"
                              style={{ width: 200 }}
                              prefix="镜像"
                              value={u.imageName}
                              onChange={(e) =>
                                setUploads((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, imageName: e.target.value } : x)))
                              }
                              disabled={u.status === 'uploading' || u.status === 'done'}
                            />
                            <InputNumber
                              size="small"
                              style={{ width: 110 }}
                              prefix="端口"
                              min={1}
                              value={u.containerPort}
                              onChange={(v) =>
                                setUploads((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, containerPort: v ?? 8000 } : x)))
                              }
                              disabled={u.status === 'uploading' || u.status === 'done'}
                            />
                            {u.status === 'done' ? <Tag color="success">已上传 #{u.artifactId}</Tag> : null}
                            {u.status === 'error' ? (
                              <Tooltip title={u.error}>
                                <Tag color="error">失败</Tag>
                              </Tooltip>
                            ) : null}
                          </Flex>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Col>
        </Row>
      </Card>

      {/* Step 2 选择产物与节点 */}
      <Card size="small" title="② 选择产物与目标节点" className="mb-4">
        <Table<ArtifactItem>
          rowKey="id"
          size="small"
          columns={artCols}
          dataSource={artifacts}
          pagination={false}
          onRow={(row) => ({
            onClick: () => selectArtifact(row),
            style: { cursor: 'pointer', background: artifactId === row.id ? '#e6f4ff' : undefined },
          })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先在上方上传 tar 产物" /> }}
          style={{ marginBottom: 16 }}
        />
        <Divider style={{ margin: '8px 0 16px' }} />
        {selectedArt ? (
          <Row gutter={[12, 12]}>
            {online.length === 0 ? (
              <Col span={24}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无在线节点" />
              </Col>
            ) : (
              online.map((n) => {
                const ok = platformMatch(selectedArt, n)
                const checked = nodeIds.includes(n.nodeId)
                const memPct =
                  n.memoryBytes > 0 && (n.memoryUsedBytes ?? -1) >= 0
                    ? Math.round(((n.memoryUsedBytes ?? 0) / n.memoryBytes) * 100)
                    : null
                const cpuPct = (n.cpuUsedPercent ?? -1) >= 0 ? Math.round(n.cpuUsedPercent ?? 0) : null
                return (
                  <Col xs={12} md={8} xl={6} key={n.nodeId}>
                    <Card
                      size="small"
                      style={{
                        cursor: ok ? 'pointer' : 'not-allowed',
                        borderColor: checked ? '#1677ff' : undefined,
                        background: checked ? '#f0f7ff' : undefined,
                        opacity: ok ? 1 : 0.55,
                      }}
                      onClick={() => (ok ? toggleNode(n.nodeId) : message.warning(`节点 ${n.nodeId} 平台 ${n.dockerPlatform} 与产物不匹配`))}
                    >
                      <Flex vertical gap={6}>
                        <Flex align="center" gap={8} justify="space-between">
                          <Flex align="center" gap={8}>
                            <Checkbox checked={checked} disabled={!ok} />
                            <Typography.Text strong>{n.nodeId}</Typography.Text>
                          </Flex>
                          <span className={`status-dot ${n.online ? 'ok' : 'bad'}`} />
                        </Flex>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {n.os}/{n.arch} · docker {n.dockerPlatform || '-'}
                        </Typography.Text>
                        <Flex gap={12} style={{ fontSize: 12 }}>
                          <span>
                            CPU {cpuPct == null ? '-' : `${cpuPct}%`} / {n.ncpu}核
                          </span>
                          <span>
                            内存 {memPct == null ? '-' : `${memPct}%`} / {memText(n.memoryBytes)}
                          </span>
                        </Flex>
                        <div className="meter-bar">
                          <div
                            className="meter-fill"
                            style={{
                              width: `${memPct ?? 0}%`,
                              background: (memPct ?? 0) >= 85 ? '#ff4d4f' : (memPct ?? 0) >= 70 ? '#faad14' : '#52c41a',
                            }}
                          />
                        </div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          容器 {n.containers.length} 个 · {n.online ? '在线' : '离线'}
                        </Typography.Text>
                      </Flex>
                    </Card>
                  </Col>
                )
              })
            )}
          </Row>
        ) : (
          <Alert type="info" showIcon title="先在上方表格点选一个产物" description="选择产物后此处显示在线节点卡片，可多选。" />
        )}
        {selectedArt && online.length > 0 ? (
          <>
            <Divider style={{ margin: '16px 0' }} />
            <Flex gap={12} wrap="wrap" align="center">
              <Radio.Group
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                optionType="button"
                options={[
                  { value: 'canary', label: '灰度发布' },
                  { value: 'all', label: '全量发布' },
                ]}
              />
              <InputNumber
                style={{ width: 140 }}
                min={1}
                max={99999}
                value={hostPort}
                onChange={(v) => setHostPort(v ?? undefined)}
                prefix="主端口"
              />
              {strategy === 'canary' && nodeIds.length > 1 ? (
                <InputNumber
                  style={{ width: 150 }}
                  min={1}
                  max={nodeIds.length}
                  value={canaryCount}
                  onChange={(v) => setCanaryCount(v || 1)}
                  addonBefore="先发"
                  addonAfter="台"
                />
              ) : null}
              {strategy === 'canary' && nodeIds.length === 1 ? (
                <InputNumber
                  style={{ width: 190 }}
                  min={1}
                  value={canaryHostPort}
                  onChange={(v) => setCanaryHostPort(v ?? undefined)}
                  placeholder="旁路灰度端口（可选）"
                />
              ) : null}
              <Input
                style={{ width: 220 }}
                placeholder="发布说明（可选）"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              {strategy === 'canary'
                ? nodeIds.length > 1
                  ? `灰度：先发 ${Math.min(canaryCount, nodeIds.length)} 台，其余等待人工推进。`
                  : sidecarMode
                    ? '旁路灰度：旧容器不中断，新版本以 cc-<服务>-canary 独立端口运行。'
                    : '灰度：发布到所选节点后，由你在任务区确认是否推进其他节点。'
                : '全量：一次性替换所有选中节点的主容器。'}
            </Typography.Text>
          </>
        ) : null}
        {selectedArt ? (
          <div style={{ marginTop: 12 }}>
            <RecommendPanel
              artifactId={artifactId}
              hostPort={hostPort}
              onDeploy={(ids) => {
                setNodeIds(ids)
                confirmDeploy(ids)
              }}
            />
          </div>
        ) : null}
      </Card>

      {/* Step 3 确认发布 */}
      <Card size="small" title="③ 确认发布" className="mb-4">
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
          <Descriptions.Item label="产物">
            {selectedArt ? `#${selectedArt.id} ${selectedArt.serviceName}` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="镜像">{selectedArt?.imageName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="主端口">{effectivePort}</Descriptions.Item>
          <Descriptions.Item label="目标节点">
            {nodeIds.length > 0 ? (
              <Flex gap={4} wrap="wrap">
                {nodeIds.map((id) => (
                  <Tag key={id}>{id}</Tag>
                ))}
              </Flex>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="策略">
            {strategy === 'all'
              ? `全量（${nodeIds.length} 台）`
              : nodeIds.length > 1
                ? `灰度（先发 ${Math.min(canaryCount, nodeIds.length)} 台）`
                : sidecarMode
                  ? `旁路灰度（cc-${selectedArt?.serviceName}-canary : ${canaryHostPort}）`
                  : '灰度（单节点）'}
          </Descriptions.Item>
          <Descriptions.Item label="发布后保护">
            <Tag color="green" icon={<SafetyOutlined />}>
              健康检查失败自动回滚
            </Tag>
          </Descriptions.Item>
        </Descriptions>
        <Button
          type="primary"
          size="large"
          icon={<RocketOutlined />}
          style={{ marginTop: 12 }}
          disabled={!artifactId || nodeIds.length === 0}
          onClick={() => confirmDeploy(nodeIds)}
        >
          {strategy === 'all' ? `全量发布（${nodeIds.length} 台）` : '灰度发布'}
        </Button>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          发布后 Agent 拉取产物 → docker load → 替换容器 → 探测 <code>/api/v1/health</code>；失败自动恢复旧镜像并标记任务。
        </Typography.Text>
      </Card>

      {/* 灰度推进提示 */}
      {waitingByArtifact.map(([id, list]) => (
        <Alert
          key={`w-${id}`}
          className="mb-3"
          type="info"
          showIcon
          icon={<ThunderboltOutlined />}
          title={`产物 #${id} 灰度进行中`}
          description={`${list.length} 台节点等待推进。确认灰度节点健康后再发布其余节点。`}
          action={
            <Button
              type="primary"
              size="small"
              loading={promoting}
              onClick={() => onPromote(id, '推进其余节点？', '等待中的任务变为执行中，由各节点 Agent 拉取执行。')}
            >
              推进其余节点
            </Button>
          }
        />
      ))}
      {sidecarReady.map((j) => (
        <Alert
          key={`c-${j.id}`}
          className="mb-3"
          type="success"
          showIcon
          icon={<ThunderboltOutlined />}
          title={`产物 #${j.artifactId} 旁路灰度已运行`}
          description={`${j.serviceName} @ ${j.nodeId} 的 canary 容器在端口 ${j.hostPort}。转正会替换主容器并下线 canary。`}
          action={
            <Button
              type="primary"
              size="small"
              loading={promoting}
              onClick={() => onPromote(j.artifactId, '转正旁路灰度？', '将该产物发布为主容器，并删除 cc-*-canary。')}
            >
              转正
            </Button>
          }
        />
      ))}

      {/* 任务区 */}
      <Card size="small" title="发布任务（实时刷新）">
        <Table<DeployJobItem>
          rowKey="id"
          size="small"
          columns={jobCols}
          dataSource={jobs}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有发布任务" /> }}
        />
      </Card>
    </>
  )
}
