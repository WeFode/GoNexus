import { Alert, App, Button, Empty, Flex, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDeploy,
  listArtifacts,
  listDeployJobs,
  listNodes,
  promoteDeploy,
  rollbackDeploy,
  uploadArtifact,
  type ArtifactItem,
  type DeployJobItem,
  type NodeItem,
} from '../api/deploy'
import { PageHeader } from '../components/PageHeader'

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

function statusColor(v: string) {
  if (v === 'success') return 'success'
  if (v === 'failed') return 'error'
  if (v === 'waiting') return 'warning'
  return 'processing'
}

export function DeploysPage() {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [nodes, setNodes] = useState<NodeItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([])
  const [jobs, setJobs] = useState<DeployJobItem[]>([])
  const [nodeIds, setNodeIds] = useState<string[]>([])
  const [artifactId, setArtifactId] = useState<number>()
  const [hostPort, setHostPort] = useState<number>()
  const [strategy, setStrategy] = useState<'canary' | 'all'>('canary')
  const [canaryCount, setCanaryCount] = useState(1)
  const [canaryHostPort, setCanaryHostPort] = useState<number>()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [form] = Form.useForm()

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
    const t = setInterval(() => void reload(), 8000)
    return () => clearInterval(t)
  }, [reload])

  const online = nodes.filter((n) => n.online)
  const selectedNodes = nodes.filter((n) => nodeIds.includes(n.nodeId))
  const selectedArt = artifacts.find((a) => a.id === artifactId)
  const platformMismatch = selectedNodes.some(
    (n) =>
      Boolean(
        n.dockerPlatform &&
          selectedArt?.platform &&
          n.dockerPlatform !== selectedArt.platform.replace('x86_64', 'amd64'),
      ),
  )
  const sidecar = strategy === 'canary' && nodeIds.length === 1 && Boolean(canaryHostPort)
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
      if (jobs.some((x) => x.action === 'stop-canary' && x.artifactId === j.artifactId && x.id > j.id && x.status !== 'failed')) {
        continue
      }
      if (jobs.some((x) => x.action === 'deploy' && x.artifactId === j.artifactId && x.nodeId === j.nodeId && x.id > j.id && x.status === 'success')) {
        continue
      }
      if (jobs.some((x) => x.status === 'waiting' && x.artifactId === j.artifactId)) continue
      if (seen.has(j.artifactId)) continue
      seen.add(j.artifactId)
      out.push(j)
    }
    return out
  }, [jobs])

  const onPickTar = (file: File) => {
    setPendingFile(file)
    form.setFieldsValue(guessMeta(file.name))
    setUploadOpen(true)
    return false
  }

  const onUploadOk = async () => {
    if (!pendingFile) return
    const values = await form.validateFields()
    setUploading(true)
    try {
      await uploadArtifact(pendingFile, values)
      message.success('已上传')
      setUploadOpen(false)
      setPendingFile(null)
      await reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const onDeploy = () => {
    if (nodeIds.length === 0 || !artifactId) {
      message.warning('请选择在线节点和产物')
      return
    }
    if (sidecar && canaryHostPort === (hostPort || selectedArt?.containerPort)) {
      message.warning('灰度端口不能与主端口相同')
      return
    }
    const art = artifacts.find((a) => a.id === artifactId)
    const port = hostPort || art?.containerPort || 8000
    const names = nodeIds.join(', ')
    let content = `镜像 ${art?.imageName}，主端口 ${port}。`
    if (strategy === 'all') {
      content += `将同时替换 ${nodeIds.length} 台节点上的主容器。`
    } else if (sidecar) {
      content += `旧容器不中断；新版本以 cc-${art?.serviceName}-canary 监听 ${canaryHostPort}。确认后再点「转正」。`
    } else {
      content += `先发前 ${Math.min(canaryCount, nodeIds.length)} 台，其余等待推进。`
    }
    modal.confirm({
      title: `发布 ${art?.serviceName} 到 ${names}？`,
      content,
      okText: '发布',
      onOk: async () => {
        const res = await createDeploy({
          nodeIds,
          artifactId,
          hostPort,
          strategy,
          canaryCount,
          canaryHostPort: sidecar ? canaryHostPort : undefined,
        })
        message.success(`已下发任务 ${res.jobIds.join(',')}`)
        await reload()
      },
    })
  }

  const onRollback = (row: DeployJobItem) => {
    modal.confirm({
      title: `回滚 ${row.serviceName} @ ${row.nodeId}？`,
      content: '将上一成功版本重新发布为新任务，不会删除历史。',
      okText: '回滚',
      onOk: async () => {
        const res = await rollbackDeploy(row.nodeId, row.serviceName)
        message.success(`已下发回滚任务 ${res.jobId}`)
        await reload()
      },
    })
  }

  const onPromote = (artifactId: number, title: string, content: string) => {
    modal.confirm({
      title,
      content,
      okText: '推进',
      onOk: async () => {
        setPromoting(true)
        try {
          const res = await promoteDeploy(artifactId)
          message.success(`已推进 ${res.jobIds.join(',')}`)
          await reload()
        } finally {
          setPromoting(false)
        }
      },
    })
  }

  const artCols: TableProps<ArtifactItem>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '服务', dataIndex: 'serviceName', width: 160 },
    { title: '镜像', dataIndex: 'imageName', ellipsis: true },
    { title: '平台', dataIndex: 'platform', width: 130 },
    { title: '端口', dataIndex: 'containerPort', width: 70 },
    {
      title: '大小',
      dataIndex: 'fileSize',
      width: 90,
      render: (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`,
    },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
  ]

  const jobCols: TableProps<DeployJobItem>['columns'] = [
    { title: '任务', dataIndex: 'id', width: 70 },
    { title: '节点', dataIndex: 'nodeId', width: 120 },
    { title: '服务', dataIndex: 'serviceName', width: 140 },
    { title: '动作', dataIndex: 'action', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag>,
    },
    { title: '说明', dataIndex: 'message', ellipsis: true },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '',
      key: 'rb',
      width: 80,
      render: (_, row) =>
        row.status === 'success' && (row.action === 'deploy' || row.action === 'rollback') ? (
          <Button type="link" size="small" danger onClick={() => onRollback(row)}>
            回滚
          </Button>
        ) : null,
    },
  ]

  const nodeOptions = useMemo(
    () =>
      online.map((n) => ({
        value: n.nodeId,
        label: `${n.nodeId} · ${n.dockerPlatform || n.os}`,
      })),
    [online],
  )

  return (
    <>
      <PageHeader
        title="发布"
        description="上传 package.ps1 打出的 tar。灰度：多节点先发金丝雀再推进；单节点用旁路端口跑 canary，旧容器不中断。配置热更新仍走 etcd。"
        extra={
          <Button onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
        }
      />
      {online.length === 0 ? (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message="没有在线节点"
          description="在目标机器执行 cd deploy-agent && go run .（Linux 同样）。节点上线后才能发布，无需 SSH 拷 tar。"
        />
      ) : null}
      {platformMismatch ? (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="产物平台与节点 Docker 架构不一致"
          description="请用 .\package.ps1 -Platform linux/arm64（或 amd64）重新打包后再发。"
        />
      ) : null}
      {waitingByArtifact.map(([id, list]) => (
        <Alert
          key={`w-${id}`}
          className="mb-4"
          type="info"
          showIcon
          message={`产物 #${id} 灰度进行中`}
          description={`${list.length} 台节点等待推进。确认金丝雀节点正常后再发布其余节点。`}
          action={
            <Button
              type="primary"
              size="small"
              loading={promoting}
              onClick={() =>
                onPromote(id, '推进其余节点？', '等待中的任务将变为 pending，由各节点 Agent 拉取执行。')
              }
            >
              推进其余节点
            </Button>
          }
        />
      ))}
      {sidecarReady.map((j) => (
        <Alert
          key={`c-${j.id}`}
          className="mb-4"
          type="success"
          showIcon
          message={`产物 #${j.artifactId} 旁路灰度已运行`}
          description={`${j.serviceName} @ ${j.nodeId} 的 canary 容器在端口 ${j.hostPort}。转正会替换主容器并下线 canary。`}
          action={
            <Button
              type="primary"
              size="small"
              loading={promoting}
              onClick={() =>
                onPromote(j.artifactId, '转正旁路灰度？', '将把该产物发布为主容器，并删除 cc-*-canary。')
              }
            >
              转正
            </Button>
          }
        />
      ))}
      <Flex gap={8} wrap="wrap" className="mb-4" align="center">
        <Upload beforeUpload={onPickTar} showUploadList={false} accept=".tar">
          <Button type="primary">上传 tar</Button>
        </Upload>
        <Select
          mode="multiple"
          placeholder="在线节点（可多选）"
          style={{ minWidth: 260 }}
          value={nodeIds}
          onChange={setNodeIds}
          options={nodeOptions}
          notFoundContent="无在线节点"
        />
        <Select
          placeholder="产物"
          style={{ width: 280 }}
          value={artifactId}
          onChange={(id) => {
            setArtifactId(id)
            const hit = artifacts.find((a) => a.id === id)
            if (hit && !hostPort) setHostPort(hit.containerPort)
          }}
          options={artifacts.map((a) => ({
            value: a.id,
            label: `#${a.id} ${a.serviceName} ${a.platform}`,
          }))}
        />
        <InputNumber
          style={{ width: 140 }}
          placeholder="主端口"
          min={1}
          value={hostPort}
          onChange={(v) => setHostPort(v ?? undefined)}
        />
        <Radio.Group
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          optionType="button"
          options={[
            { value: 'canary', label: '灰度' },
            { value: 'all', label: '全量' },
          ]}
        />
        {strategy === 'canary' && nodeIds.length > 1 ? (
          <InputNumber
            style={{ width: 130 }}
            min={1}
            max={nodeIds.length}
            value={canaryCount}
            onChange={(v) => setCanaryCount(v || 1)}
            addonBefore="先发"
            addonAfter="台"
          />
        ) : null}
        {strategy === 'canary' && nodeIds.length <= 1 ? (
          <InputNumber
            style={{ width: 180 }}
            placeholder="灰度端口（可选）"
            min={1}
            value={canaryHostPort}
            onChange={(v) => setCanaryHostPort(v ?? undefined)}
          />
        ) : null}
        <Button
          type="primary"
          onClick={onDeploy}
          disabled={nodeIds.length === 0 || !artifactId || platformMismatch}
        >
          {strategy === 'all' ? '全量发布' : '灰度发布'}
        </Button>
      </Flex>
      <Typography.Title level={5}>产物</Typography.Title>
      <Table<ArtifactItem>
        rowKey="id"
        loading={loading}
        size="small"
        columns={artCols}
        dataSource={artifacts}
        pagination={false}
        locale={{ emptyText: <Empty description="先运行 .\package.ps1，再上传 tar" /> }}
        className="mb-6"
      />
      <Typography.Title level={5}>任务</Typography.Title>
      <Table<DeployJobItem>
        rowKey="id"
        loading={loading}
        size="small"
        columns={jobCols}
        dataSource={jobs}
        pagination={false}
        locale={{ emptyText: <Empty description="还没有发布任务" /> }}
      />
      <Space className="mt-2">
        <Typography.Text type="secondary">在线节点 {online.length}</Typography.Text>
      </Space>
      <Modal
        title="确认产物信息"
        open={uploadOpen}
        onCancel={() => {
          setUploadOpen(false)
          setPendingFile(null)
        }}
        onOk={() => void onUploadOk()}
        confirmLoading={uploading}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {pendingFile ? pendingFile.name : ''}
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="serviceName" label="服务名" rules={[{ required: true }]}>
            <Input placeholder="与 etcd services/<名>、svc.etcd.host @ 后一致" />
          </Form.Item>
          <Form.Item name="imageName" label="镜像名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="platform" label="平台" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'linux/amd64', label: 'linux/amd64' },
                { value: 'linux/arm64', label: 'linux/arm64' },
              ]}
            />
          </Form.Item>
          <Form.Item name="containerPort" label="容器端口" rules={[{ required: true }]}>
            <InputNumber min={1} className="w-full" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
