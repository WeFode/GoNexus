import { App, Button, Card, Col, Empty, Flex, Input, Modal, Popconfirm, Row, Tag, Typography } from 'antd'
import {
  ApiOutlined,
  BookOutlined,
  EyeOutlined,
  HistoryOutlined,
  InboxOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  /** 服务名列表，用于公共配置的影响面提示 */
  listServiceNames?: () => Promise<string[]>
  save: (key: string, content: string, meta?: AuditMeta) => Promise<unknown>
  remove: (key: string, meta?: AuditMeta) => Promise<unknown>
  preview?: (key: string) => Promise<{ name: string; content: string }>
}

export function ConfigListPage({ kind, list, listServiceNames, save, remove, preview }: Props) {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ConfigItem[]>([])
  const [serviceNames, setServiceNames] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
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

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [items, names] = await Promise.all([
        list(),
        listServiceNames ? listServiceNames() : Promise.resolve([]),
      ])
      setRows(items)
      setServiceNames(names)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [list, listServiceNames, message])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(
    () => rows.filter((r) => r.key.toLowerCase().includes(keyword.trim().toLowerCase())),
    [rows, keyword],
  )

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
      message.success(
        isService
          ? `已保存，${key} 将在 1 秒内热加载`
          : `已保存，${serviceNames.length} 个服务将陆续热加载`,
      )
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
        <Flex vertical gap={12}>
          {isService ? (
            <Typography.Text type="secondary">
              该服务热加载将得到「key 不存在」，本地快照兜底仍可运行。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              全部 {serviceNames.length} 个服务的合并配置中将失去此段内容。
            </Typography.Text>
          )}
          <Input
            placeholder="删除原因（写入审计）"
            onChange={(e) => {
              remark = e.target.value
            }}
          />
        </Flex>
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

  return (
    <>
      <PageHeader
        title={title}
        description={
          isService
            ? '各微服务专属配置，保存后该服务 1 秒内热加载'
            : '所有微服务启动时合并；变更将热推送至全部服务'
        }
        extra={
          <Flex gap={8}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={`搜索${keyLabel}`}
              style={{ width: 180 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            {isService ? (
              <Button
                onClick={() => {
                  setOnboardName('')
                  setOnboardOpen(true)
                }}
              >
                接入指引
              </Button>
            ) : null}
            <Button type="primary" onClick={openCreate}>
              新建{keyLabel}
            </Button>
          </Flex>
        }
      />

      {!isService && serviceNames.length > 0 ? (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Flex align="center" gap={8} wrap="wrap">
            <ThunderboltOutlined style={{ color: '#faad14' }} />
            <Typography.Text>
              公共配置变更将<strong>热推送至全部 {serviceNames.length} 个服务</strong>
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                （watch 1 秒内生效，数据库/Redis 连接类变更建议结合服务重启）
              </Typography.Text>
            </Typography.Text>
            <Flex gap={4} style={{ marginLeft: 'auto' }} wrap="wrap">
              {serviceNames.slice(0, 5).map((n) => (
                <Tag key={n}>{n}</Tag>
              ))}
              {serviceNames.length > 5 ? <Tag>+{serviceNames.length - 5}</Tag> : null}
            </Flex>
          </Flex>
        </Card>
      ) : null}

      {filtered.length === 0 && !loading ? (
        <Card>
          <Empty
            image={<InboxOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
            description={
              <Flex vertical align="center" gap={8}>
                <Typography.Text>
                  {rows.length === 0
                    ? `还没有${keyLabel}。${isService ? '新建后可复制 GoFrame 接入代码。' : ''}`
                    : '没有匹配结果'}
                </Typography.Text>
                {rows.length === 0 ? (
                  <Button type="primary" onClick={openCreate}>
                    新建{keyLabel}
                  </Button>
                ) : null}
              </Flex>
            }
            style={{ padding: 32 }}
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((row) => (
            <Col xs={24} md={12} xl={8} key={row.fullKey}>
              <Card
                size="small"
                loading={loading}
                title={
                  <Flex align="center" gap={8}>
                    <Typography.Text strong style={{ fontSize: 15 }} ellipsis>
                      {row.key}
                    </Typography.Text>
                    <Tag style={{ marginInlineEnd: 0 }} title="etcd revision">
                      r{row.revision}
                    </Tag>
                  </Flex>
                }
                extra={
                  <Typography.Text type="secondary" copyable={{ text: row.fullKey }} style={{ fontSize: 12 }}>
                    etcd 路径
                  </Typography.Text>
                }
                actions={[
                  <Button key="edit" type="link" size="small" icon={<ApiOutlined />} onClick={() => openEdit(row)}>
                    编辑
                  </Button>,
                  <Button key="history" type="link" size="small" icon={<HistoryOutlined />} onClick={() => setHistoryRow(row)}>
                    历史
                  </Button>,
                  ...(preview
                    ? [
                        <Button
                          key="preview"
                          type="link"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => void onPreview(row)}
                        >
                          预览合并
                        </Button>,
                      ]
                    : []),
                  ...(isService
                    ? [
                        <Button
                          key="onboard"
                          type="link"
                          size="small"
                          icon={<BookOutlined />}
                          onClick={() => {
                            setOnboardName(row.key)
                            setOnboardOpen(true)
                          }}
                        >
                          接入代码
                        </Button>,
                      ]
                    : []),
                  <Popconfirm
                    key="del"
                    title={`删除 ${row.key}？`}
                    description="删除会写入审计历史"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDelete(row)}
                  >
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <YamlEditor
                  value={row.content}
                  readOnly
                  autoSize={{ minRows: 6, maxRows: 10 }}
                  style={{ background: '#fafafa', resize: 'none' }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <ConfigEditorModal
        open={editorOpen}
        title={editing ? `编辑 ${editing.key}` : `新建${keyLabel}`}
        keyLabel={keyLabel}
        keyPlaceholder={isService ? 'shop-server' : 'database'}
        keyDisabled={Boolean(editing)}
        initial={editing ? { key: editing.key, content: editing.content } : undefined}
        defaultContent={isService && !editing ? SERVICE_DEFAULT_YAML : undefined}
        submitting={submitting}
        impact={
          isService
            ? { kind: 'service', serviceCount: 1, serviceName: editing?.key }
            : { kind: 'shared', serviceCount: serviceNames.length }
        }
        onCancel={() => setEditorOpen(false)}
        onSubmit={(v) => void onSubmit(v)}
      />

      <Modal
        title={`合并预览 · ${previewName}`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={720}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          公共配置 + 服务配置合并后的最终生效内容（服务视角）：
        </Typography.Paragraph>
        <YamlEditor value={previewText} readOnly />
      </Modal>

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
