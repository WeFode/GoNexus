import { Alert, App, Button, Empty, Flex, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDeploy,
  listArtifacts,
  listDeployJobs,
  listNodes,
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

export function DeploysPage() {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [nodes, setNodes] = useState<NodeItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([])
  const [jobs, setJobs] = useState<DeployJobItem[]>([])
  const [nodeId, setNodeId] = useState<string>()
  const [artifactId, setArtifactId] = useState<number>()
  const [hostPort, setHostPort] = useState<number>()
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
  const selectedNode = nodes.find((n) => n.nodeId === nodeId)
  const selectedArt = artifacts.find((a) => a.id === artifactId)
  const platformMismatch = Boolean(
    selectedNode?.dockerPlatform &&
      selectedArt?.platform &&
      selectedNode.dockerPlatform !== selectedArt.platform.replace('x86_64', 'amd64'),
  )

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
    if (!nodeId || !artifactId) {
      message.warning('请选择在线节点和产物')
      return
    }
    const art = artifacts.find((a) => a.id === artifactId)
    const port = hostPort || art?.containerPort || 8000
    modal.confirm({
      title: `发布 ${art?.serviceName} 到 ${nodeId}？`,
      content: `镜像 ${art?.imageName}，宿主机端口 ${port}。只发一台即灰度；确认无误后再发其它节点。`,
      okText: '发布',
      onOk: async () => {
        const res = await createDeploy([nodeId], artifactId, hostPort)
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
    { title: '动作', dataIndex: 'action', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => {
        const color = v === 'success' ? 'success' : v === 'failed' ? 'error' : 'processing'
        return <Tag color={color}>{v}</Tag>
      },
    },
    { title: '说明', dataIndex: 'message', ellipsis: true },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '',
      key: 'rb',
      width: 80,
      render: (_, row) =>
        row.status === 'success' && row.action !== 'stop' ? (
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
        description="上传 package.ps1 打出的 tar，选在线节点发布。配置热更新仍走 etcd，与换镜像相互独立。"
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
      <Flex gap={8} wrap="wrap" className="mb-4" align="center">
        <Upload beforeUpload={onPickTar} showUploadList={false} accept=".tar">
          <Button type="primary">上传 tar</Button>
        </Upload>
        <Select
          placeholder="在线节点"
          style={{ width: 220 }}
          value={nodeId}
          onChange={setNodeId}
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
          placeholder="宿主机端口"
          min={1}
          value={hostPort}
          onChange={(v) => setHostPort(v ?? undefined)}
        />
        <Button type="primary" onClick={onDeploy} disabled={!nodeId || !artifactId || platformMismatch}>
          发布到该节点
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
