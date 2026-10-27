import {
  CheckCircleFilled,
  CloudServerOutlined,
  ClusterOutlined,
  CloseCircleFilled,
  DatabaseOutlined,
  FileAddOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { App, Button, Card, Col, Empty, Flex, List, Row, Spin, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHealth, listServices, listShared, seedConfigs, type HealthRes } from '../api/config'
import { actionLabel, jobStatusLabel, listDeployJobs, listNodes, type DeployJobItem } from '../api/deploy'
import { PageHeader } from '../components/PageHeader'

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircleFilled style={{ color: '#52c41a' }} />
  ) : (
    <CloseCircleFilled style={{ color: '#ff4d4f' }} />
  )
}

export function OverviewPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const [health, setHealth] = useState<HealthRes | null>(null)
  const [serviceNames, setServiceNames] = useState<string[]>([])
  const [sharedCount, setSharedCount] = useState(0)
  const [onlineNodes, setOnlineNodes] = useState(0)
  const [totalNodes, setTotalNodes] = useState(0)
  const [jobs, setJobs] = useState<DeployJobItem[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [h, shared, services, nodes, jobList] = await Promise.all([
        getHealth(),
        listShared(),
        listServices(),
        listNodes(),
        listDeployJobs(),
      ])
      setHealth(h)
      setSharedCount(shared.length)
      setServiceNames(services.map((s) => s.key))
      setOnlineNodes(nodes.filter((n) => n.online).length)
      setTotalNodes(nodes.length)
      setJobs(jobList.slice(0, 8))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 15000)
    return () => clearInterval(t)
  }, [reload])

  const onSeed = (force: boolean) => {
    modal.confirm({
      title: force ? '强制覆盖 seed？' : '写入缺失的 seed？',
      content: force
        ? '会用本地 manifest/etcd-seed 覆盖 etcd 中已有配置，所有服务将热加载变更。'
        : '只写入 etcd 中尚不存在的 key，不影响现有配置。',
      okText: force ? '覆盖写入' : '写入缺失项',
      okButtonProps: force ? { danger: true } : undefined,
      onOk: async () => {
        const res = await seedConfigs(force, { remark: force ? 'force seed' : 'seed missing' })
        message.success(`已写入 ${res.written} 条`)
        await reload()
      },
    })
  }

  const etcdOk = health?.status === 'ok'

  return (
    <>
      <PageHeader
        title="概览"
        description=""
        extra={
          <Flex gap={8}>
            <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button onClick={() => onSeed(false)}>写入 seed</Button>
            <Button danger onClick={() => onSeed(true)}>
              强制覆盖
            </Button>
          </Flex>
        }
      />
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12} xl={6}>
          <Card size="small">
            <Flex vertical gap={8}>
              <Flex align="center" gap={8} justify="space-between">
                <Flex align="center" gap={8}>
                  <ThunderboltOutlined />
                  <Typography.Text strong>etcd 配置源</Typography.Text>
                </Flex>
                <StatusIcon ok={etcdOk} />
              </Flex>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {etcdOk ? '连接正常，watch 推送中' : '连接异常，服务将使用本地快照'}
              </Typography.Text>
            </Flex>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" hoverable onClick={() => navigate('/shared')}>
            <Flex align="center" gap={8} justify="space-between">
              <Flex align="center" gap={8}>
                <DatabaseOutlined />
                <Typography.Text strong>公共配置</Typography.Text>
              </Flex>
              <Typography.Text strong style={{ fontSize: 18 }}>
                {sharedCount}
              </Typography.Text>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              变更热推送至全部 {serviceNames.length || '—'} 个服务
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" hoverable onClick={() => navigate('/services')}>
            <Flex align="center" gap={8} justify="space-between">
              <Flex align="center" gap={8}>
                <ClusterOutlined />
                <Typography.Text strong>服务配置</Typography.Text>
              </Flex>
              <Typography.Text strong style={{ fontSize: 18 }}>
                {serviceNames.length}
              </Typography.Text>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              {serviceNames.length ? serviceNames.join(' · ') : '尚无服务'}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" hoverable onClick={() => navigate('/nodes')}>
            <Flex align="center" gap={8} justify="space-between">
              <Flex align="center" gap={8}>
                <CloudServerOutlined />
                <Typography.Text strong>在线节点</Typography.Text>
              </Flex>
              <Typography.Text strong style={{ fontSize: 18 }}>
                {onlineNodes}/{totalNodes}
              </Typography.Text>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              deploy-agent 心跳上报
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={9}>
          <Card size="small" title="常用操作" style={{ height: '100%' }}>
            <Flex vertical gap={12}>
              <Button
                block
                size="large"
                icon={<RocketOutlined />}
                onClick={() => navigate('/deploys')}
                style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}
              >
                发布新版本 —— 上传 tar，灰度/全量下发
              </Button>
              <Button
                block
                size="large"
                icon={<FileAddOutlined />}
                onClick={() => navigate('/services')}
                style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}
              >
                新增服务配置 —— 接入配置中心
              </Button>
              <Button
                block
                size="large"
                icon={<SettingOutlined />}
                onClick={() => navigate('/shared')}
                style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}
              >
                修改公共配置 —— 影响全部服务
              </Button>
            </Flex>
            <Flex gap={6} style={{ marginTop: 16 }} wrap="wrap">
              <Tag icon={<SafetyOutlined />} color="blue">
                发布自动健康检查
              </Tag>
              <Tag icon={<SafetyOutlined />} color="green">
                失败自动回滚旧镜像
              </Tag>
            </Flex>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card size="small" title="最近发布任务" extra={<a onClick={() => navigate('/deploys')}>全部 →</a>}>
            {loading && jobs.length === 0 ? (
              <Flex justify="center" style={{ padding: 32 }}>
                <Spin />
              </Flex>
            ) : jobs.length === 0 ? (
              <Empty description="还没有发布任务，点左侧「发布新版本」开始" style={{ padding: 16 }} />
            ) : (
              <List
                size="small"
                dataSource={jobs}
                rowKey="id"
                renderItem={(j) => (
                  <List.Item>
                    <Flex align="center" gap={8} style={{ width: '100%' }} justify="space-between">
                      <Flex align="center" gap={8}>
                        <Tag color={j.status === 'success' ? 'success' : j.status === 'failed' ? 'error' : 'processing'}>
                          {jobStatusLabel(j.status)}
                        </Tag>
                        <Typography.Text strong>{j.serviceName}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {actionLabel(j.action)} → {j.nodeId}
                        </Typography.Text>
                      </Flex>
                      <Tooltip title={j.message || ''}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                          {j.message || '-'}
                        </Typography.Text>
                      </Tooltip>
                    </Flex>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  )
}
