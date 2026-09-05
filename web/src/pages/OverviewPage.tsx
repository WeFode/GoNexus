import { CloudSyncOutlined, DatabaseOutlined, ClusterOutlined, CloudServerOutlined } from '@ant-design/icons'
import { App, Button, Card, Col, Flex, Row, Statistic, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHealth, listServices, listShared, seedConfigs, type HealthRes } from '../api/config'
import { listNodes } from '../api/deploy'
import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../components/PageHeader'

export function OverviewPage() {
  const { message, modal } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [health, setHealth] = useState<HealthRes | null>(null)
  const [sharedCount, setSharedCount] = useState<number>()
  const [serviceCount, setServiceCount] = useState<number>()
  const [onlineNodes, setOnlineNodes] = useState<number>()
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [h, shared, services, nodes] = await Promise.all([
        getHealth(),
        listShared(),
        listServices(),
        listNodes(),
      ])
      setHealth(h)
      setSharedCount(shared.length)
      setServiceCount(services.length)
      setOnlineNodes(nodes.filter((n) => n.online).length)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void reload()
  }, [reload])

  const onSeed = (force: boolean) => {
    modal.confirm({
      title: force ? '强制覆盖 seed？' : '写入缺失的 seed？',
      content: force
        ? '会用本地 manifest/etcd-seed 覆盖 etcd 中已有配置。'
        : '只写入 etcd 中尚不存在的 key。',
      okText: force ? '覆盖写入' : '写入缺失项',
      okButtonProps: force ? { danger: true } : undefined,
      onOk: async () => {
        const res = await seedConfigs(force, { remark: force ? 'force seed' : 'seed missing' })
        message.success(`已写入 ${res.written} 条`)
        await reload()
      },
    })
  }

  const ok = health?.status === 'ok'

  return (
    <>
      <PageHeader
        title="概览"
        description="配置中心对接 etcd，统一管理公共配置与各微服务配置。"
        extra={
          <Flex gap={8}>
            <Button onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button onClick={() => onSeed(false)}>写入 seed</Button>
            {user?.role === 'admin' ? (
              <Button danger onClick={() => onSeed(true)}>
                强制覆盖 seed
              </Button>
            ) : null}
          </Flex>
        }
      />
      <Row gutter={16}>
        <Col span={6}>
          <Card loading={loading}>
            <Flex vertical gap={8}>
              <Flex align="center" gap={8}>
                <CloudSyncOutlined />
                <Typography.Text type="secondary">etcd</Typography.Text>
              </Flex>
              <Tag color={ok ? 'success' : 'error'} className="w-fit text-base">
                {health?.etcd ?? '-'}
              </Tag>
              <Typography.Text type="secondary">GET /api/v1/health</Typography.Text>
            </Flex>
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading} hoverable onClick={() => navigate('/shared')}>
            <Statistic title="公共配置" prefix={<DatabaseOutlined />} value={sharedCount ?? '-'} />
            <Typography.Text type="secondary">/config-center/shared/*</Typography.Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading} hoverable onClick={() => navigate('/services')}>
            <Statistic title="服务配置" prefix={<ClusterOutlined />} value={serviceCount ?? '-'} />
            <Typography.Text type="secondary">/config-center/services/*</Typography.Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading} hoverable onClick={() => navigate('/nodes')}>
            <Statistic title="在线节点" prefix={<CloudServerOutlined />} value={onlineNodes ?? '-'} />
            <Typography.Text type="secondary">deploy-agent 心跳</Typography.Text>
          </Card>
        </Col>
      </Row>
    </>
  )
}
