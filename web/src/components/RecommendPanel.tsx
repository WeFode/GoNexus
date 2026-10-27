import { Alert, Button, Card, Flex, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { recommendNode, type RecommendNode, type RecommendRes } from '../api/deploy'

function gb(n: number) {
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function Meter({ percent, text }: { percent: number | null; text: string }) {
  const color = percent == null ? undefined : percent >= 85 ? '#ff4d4f' : percent >= 70 ? '#faad14' : '#52c41a'
  return (
    <Flex vertical gap={2} style={{ minWidth: 128 }}>
      <Typography.Text>{text}</Typography.Text>
      {percent == null ? (
        <Typography.Text type="secondary">未上报</Typography.Text>
      ) : (
        <div style={{ height: 6, borderRadius: 4, background: '#f0f0f0' }}>
          <div style={{ height: 6, borderRadius: 4, width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
        </div>
      )}
    </Flex>
  )
}

export function RecommendPanel({
  artifactId,
  hostPort,
  onDeploy,
}: {
  artifactId?: number
  hostPort?: number
  onDeploy: (nodeIds: string[], remark?: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<RecommendRes | null>(null)

  useEffect(() => {
    if (!artifactId) {
      setData(null)
      setError('')
      return
    }
    let stop = false
    setData(null)
    setError('')
    const load = async () => {
      setLoading(true)
      try {
        const res = await recommendNode(artifactId, hostPort)
        if (!stop) {
          setData(res)
          setError('')
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : '推荐失败')
      } finally {
        if (!stop) setLoading(false)
      }
    }
    void load()
    const t = setInterval(() => void load(), 8000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [artifactId, hostPort])

  if (!artifactId) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12 }}
        title="选择产物后显示推荐节点"
        description="按各节点剩余内存和 CPU 打分，并说明不适合的原因。确认后再下发，不会自动部署。"
      />    )
  }

  const columns: TableProps<RecommendNode>['columns'] = [
    {
      title: '节点',
      dataIndex: 'nodeId',
      width: 140,
      render: (v: string, row) => (
        <Flex vertical>
          <Typography.Text strong>{v}</Typography.Text>
          {row.recommended ? <Tag color="success">推荐</Tag> : row.eligible ? <Tag>可部署</Tag> : <Tag>不可部署</Tag>}
        </Flex>
      ),
    },
    {
      title: 'CPU',
      width: 150,
      render: (_, row) => (
        <Meter
          percent={row.cpuUsedPercent < 0 ? null : Math.round(row.cpuUsedPercent)}
          text={row.cpuUsedPercent < 0 ? `${row.ncpu || '-'} 核` : `${Math.round(row.cpuUsedPercent)}% · ${row.ncpu} 核`}
        />
      ),
    },
    {
      title: '内存',
      width: 170,
      render: (_, row) => {
        const known = row.memoryUsedBytes >= 0 && row.memoryBytes > 0
        const pct = known ? Math.round((row.memoryUsedBytes / row.memoryBytes) * 100) : null
        const text = !row.memoryBytes
          ? '-'
          : known
            ? `${gb(row.memoryUsedBytes)} / ${gb(row.memoryBytes)}`
            : `— / ${gb(row.memoryBytes)}`
        return <Meter percent={pct} text={text} />
      },
    },
    { title: '容器', dataIndex: 'containerCount', width: 70 },
    {
      title: '空闲分',
      dataIndex: 'score',
      width: 80,
      render: (n: number, row) => (row.eligible ? n : '—'),
    },
    { title: '原因', dataIndex: 'reason' },
    {
      title: '',
      width: 130,
      render: (_, row) =>
        row.eligible && !row.recommended ? (
          <Button type="link" size="small" onClick={() => onDeploy([row.nodeId], `选择节点 ${row.nodeId}`)}>
            部署到此节点
          </Button>
        ) : null,
    },
  ]

  return (
    <Card className="mb-4" title="节点推荐" loading={loading && !data}>
      {error ? <Alert className="mb-3" type="error" showIcon title={error} /> : null}
      {data ? (
        <Flex vertical gap={12}>
          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <Typography.Paragraph className="!mb-0">{data.summary}</Typography.Paragraph>
            <Button
              type="primary"
              disabled={!data.recommendedNodeId}
              onClick={() => onDeploy([data.recommendedNodeId], `推荐节点 ${data.recommendedNodeId}`)}
            >
              部署到推荐节点
            </Button>
          </Flex>
          <Table<RecommendNode>
            rowKey="nodeId"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={data.nodes}
          />
        </Flex>
      ) : null}
    </Card>
  )
}
