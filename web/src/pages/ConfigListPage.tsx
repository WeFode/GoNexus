import { App, Button, Drawer, Empty, Flex, Input, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { AuditMeta, ConfigItem } from '../api/config'
import { ConfigEditorModal, type ConfigEditorValues } from '../components/ConfigEditorModal'
import { HistoryDrawer } from '../components/HistoryDrawer'
import { PageHeader } from '../components/PageHeader'
import { ServiceOnboardDrawer } from '../components/ServiceOnboardDrawer'
import { YamlEditor } from '../components/YamlEditor'
import { SERVICE_DEFAULT_YAML } from '../onboard/snippets'

export type ConfigKind = 'shared' | 'services'

interface Props {
  kind: ConfigKind
  list: () => Promise<ConfigItem[]>
  save: (key: string, content: string, meta?: AuditMeta) => Promise<unknown>
  remove: (key: string, meta?: AuditMeta) => Promise<unknown>
  preview?: (key: string) => Promise<{ name: string; content: string }>
}

export function ConfigListPage({ kind, list, save, remove, preview }: Props) {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ConfigItem[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ConfigItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const [previewName, setPreviewName] = useState('')
  const [historyRow, setHistoryRow] = useState<ConfigItem | null>(null)
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [onboardName, setOnboardName] = useState('')

  const isService = kind === 'services'
  const keyLabel = isService ? '服务名' : '配置名'
  const title = isService ? '服务配置' : '公共配置'
  const description = isService
    ? '写入 /config-center/services/<服务名>，会覆盖同名公共配置。新建后可复制 GoFrame 接入代码。'
    : '写入 /config-center/shared/<配置名>，所有微服务启动时合并。'

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await list())
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [list, message])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  const openEdit = (row: ConfigItem) => {
    setEditing(row)
    setEditorOpen(true)
  }

  const onSubmit = async (values: ConfigEditorValues) => {
    setSubmitting(true)
    try {
      const key = values.key.trim()
      const isCreate = !editing
      await save(key, values.content, { remark: values.remark })
      message.success('已保存')
      setEditorOpen(false)
      await reload()
      if (isService && isCreate) {
        setOnboardName(key)
        setOnboardOpen(true)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = (row: ConfigItem) => {
    let remark = ''
    modal.confirm({
      title: `删除${keyLabel}「${row.key}」？`,
      content: (
        <Input
          placeholder="删除原因（可选）"
          onChange={(e) => {
            remark = e.target.value
          }}
        />
      ),
      okButtonProps: { danger: true },
      okText: '删除',
      onOk: async () => {
        await remove(row.key, { remark })
        message.success('已删除')
        await reload()
      },
    })
  }

  const onPreview = async (row: ConfigItem) => {
    if (!preview) return
    try {
      const res = await preview(row.key)
      setPreviewName(res.name)
      setPreviewText(res.content)
      setPreviewOpen(true)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '预览失败')
    }
  }

  const columns: TableProps<ConfigItem>['columns'] = [
    {
      title: keyLabel,
      dataIndex: 'key',
      width: 180,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: 'etcd key',
      dataIndex: 'fullKey',
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text type="secondary" copyable>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: 'revision',
      dataIndex: 'revision',
      width: 90,
      render: (v: number) => <Tag>{v}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: isService ? 340 : 220,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => setHistoryRow(row)}>
            历史
          </Button>
          {preview ? (
            <Button type="link" size="small" onClick={() => void onPreview(row)}>
              预览合并
            </Button>
          ) : null}
          {isService ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setOnboardName(row.key)
                setOnboardOpen(true)
              }}
            >
              接入代码
            </Button>
          ) : null}
          <Button type="link" size="small" danger onClick={() => onDelete(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        extra={
          <Flex gap={8}>
            {isService ? (
              <Button onClick={() => { setOnboardName(''); setOnboardOpen(true) }}>
                接入指引
              </Button>
            ) : null}
            <Button onClick={() => void reload()}>刷新</Button>
            <Button type="primary" onClick={openCreate}>
              新建
            </Button>
          </Flex>
        }
      />
      <Table<ConfigItem>
        rowKey="fullKey"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              description={
                isService
                  ? '还没有服务。新建后按接入指引把 etcdcfg 接到 GoFrame cmd。'
                  : '还没有公共配置'
              }
            />
          ),
        }}
        expandable={{
          expandedRowRender: (row) => (
            <YamlEditor value={row.content} readOnly className="mt-2" />
          ),
        }}
      />
      <ConfigEditorModal
        open={editorOpen}
        title={editing ? `编辑 ${editing.key}` : `新建${keyLabel}`}
        keyLabel={keyLabel}
        keyPlaceholder={isService ? 'shop-server' : 'database'}
        keyDisabled={Boolean(editing)}
        initial={editing ? { key: editing.key, content: editing.content } : undefined}
        defaultContent={isService && !editing ? SERVICE_DEFAULT_YAML : undefined}
        submitting={submitting}
        onCancel={() => setEditorOpen(false)}
        onSubmit={(v) => void onSubmit(v)}
      />
      <Drawer
        title={`合并预览 · ${previewName}`}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        size={640}
      >
        <YamlEditor value={previewText} readOnly />
      </Drawer>
      {historyRow ? (
        <HistoryDrawer
          kind={kind}
          configKey={historyRow.key}
          current={historyRow.content}
          open
          onClose={() => setHistoryRow(null)}
          onRolledBack={() => {
            setHistoryRow(null)
            void reload()
          }}
        />
      ) : null}
      {isService ? (
        <ServiceOnboardDrawer
          open={onboardOpen}
          serviceName={onboardName}
          onClose={() => setOnboardOpen(false)}
        />
      ) : null}
    </>
  )
}
