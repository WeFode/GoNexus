import { App, Button, Col, Drawer, Flex, Row, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { listHistory, rollbackConfig, type HistoryItem } from '../api/config'
import { YamlEditor } from './YamlEditor'

interface Props {
  kind: 'shared' | 'services'
  configKey: string
  current: string
  open: boolean
  onClose: () => void
  onRolledBack: () => void
}

const actionColor: Record<string, string> = {
  CREATE: 'blue',
  UPDATE: 'processing',
  BASELINE: 'gold',
  DELETE: 'red',
  ROLLBACK: 'green',
}

export function HistoryDrawer({ kind, configKey, current, open, onClose, onRolledBack }: Props) {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<HistoryItem[]>([])
  const [selected, setSelected] = useState<HistoryItem | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setLoading(true)
    void listHistory(kind, configKey)
      .then((list) => {
        setRows(list)
        const prev = list.find((r) => r.content !== current)
        setSelected(prev ?? list[0] ?? null)
      })
      .catch((e: unknown) => message.error(e instanceof Error ? e.message : '加载历史失败'))
      .finally(() => setLoading(false))
  }, [open, kind, configKey, current, message])

  const previous = useMemo(() => rows.find((r) => r.content !== current), [rows, current])

  const onRollback = (row: HistoryItem) => {
    if (row.content === current) {
      message.warning('该版本已是当前配置')
      return
    }
    modal.confirm({
      title: `回滚到版本 ${row.version}？`,
      content: '将把该版本 YAML 作为一次新发布写入 etcd。历史记录保留，不会覆盖或删除旧行。',
      okText: '回滚',
      onOk: async () => {
        const res = await rollbackConfig(kind, configKey, row.version, {
          remark: `回滚至版本 ${row.version}`,
        })
        message.success(`已发布为版本 ${res.version}`)
        onRolledBack()
      },
    })
  }

  const columns: TableProps<HistoryItem>['columns'] = [
    { title: '版本', dataIndex: 'version', width: 72 },
    {
      title: '操作',
      dataIndex: 'actionType',
      width: 110,
      render: (v: string) => <Tag color={actionColor[v] || 'default'}>{v}</Tag>,
    },
    { title: '操作人', dataIndex: 'operator', width: 100, ellipsis: true },
    { title: '说明', dataIndex: 'remark', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '',
      key: 'rb',
      width: 80,
      render: (_, row) =>
        row.content === current ? (
          <Typography.Text type="secondary">当前</Typography.Text>
        ) : (
          <Button type="link" size="small" onClick={() => onRollback(row)}>
            回滚
          </Button>
        ),
    },
  ]

  return (
    <Drawer
      title={`历史 · ${configKey}`}
      open={open}
      onClose={onClose}
      size={960}
      extra={
        previous ? (
          <Button type="primary" onClick={() => onRollback(previous)}>
            回滚到上一版
          </Button>
        ) : null
      }
    >
      <Typography.Paragraph type="secondary">
        每次保存都会把<strong>修改前</strong>的 YAML 补进历史（若尚不存在），再追加新版本。回滚是一次新发布，不会删掉任何历史行。
      </Typography.Paragraph>
      <Table<HistoryItem>
        rowKey="id"
        loading={loading}
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        rowClassName={(row) => (selected?.id === row.id ? 'ant-table-row-selected' : '')}
        onRow={(row) => ({
          onClick: () => setSelected(row),
        })}
      />
      <Row gutter={16} className="mt-4">
        <Col span={12}>
          <Typography.Text type="secondary">当前 etcd</Typography.Text>
          <YamlEditor value={current} readOnly className="mt-2" />
        </Col>
        <Col span={12}>
          <Flex justify="space-between">
            <Typography.Text type="secondary">
              选中版本 {selected ? `v${selected.version}` : '-'}
            </Typography.Text>
          </Flex>
          <YamlEditor value={selected?.content ?? ''} readOnly className="mt-2" />
        </Col>
      </Row>
    </Drawer>
  )
}
