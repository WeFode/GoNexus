import { Alert, Form, Input, Modal, Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { YamlEditor } from './YamlEditor'

export interface ConfigEditorValues {
  key: string
  content: string
  remark: string
}

interface Props {
  open: boolean
  title: string
  keyLabel: string
  keyPlaceholder: string
  submitting?: boolean
  initial?: Partial<ConfigEditorValues>
  keyDisabled?: boolean
  defaultContent?: string
  /** 影响面提示：shared=公共配置将热推送至全部服务；service=仅该服务热加载 */
  impact?: { kind: 'shared' | 'service'; serviceCount: number; serviceName?: string }
  onCancel: () => void
  onSubmit: (values: ConfigEditorValues) => void
}

export function ConfigEditorModal({
  open,
  title,
  keyLabel,
  keyPlaceholder,
  submitting,
  initial,
  keyDisabled,
  defaultContent,
  impact,
  onCancel,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<ConfigEditorValues>()

  const impactAlert = impact?.kind === 'shared' ? (
    <Alert
      type="warning"
      showIcon
      icon={<ThunderboltOutlined />}
      style={{ marginBottom: 16 }}
      title="公共配置：保存后立即热推送"
      description={`全部 ${impact.serviceCount} 个已接入服务将在 1 秒内重新加载配置，无需重启。请确认变更影响范围。`}
    />
  ) : impact?.kind === 'service' && initial?.key ? (
    <Alert
      type="info"
      showIcon
      icon={<ThunderboltOutlined />}
      style={{ marginBottom: 16 }}
      title="服务配置：仅此服务热加载"
      description={`${impact.serviceName ?? '该服务'} 会在 1 秒内重新加载，其他服务不受影响。`}
    />
  ) : null

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="保存并热推送"
      confirmLoading={submitting}
      width={760}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) {
          form.setFieldsValue({
            key: initial?.key ?? '',
            content: initial?.content ?? defaultContent ?? '',
            remark: initial?.remark ?? '',
          })
        } else {
          form.resetFields()
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        initialValues={{ key: '', content: '', remark: '' }}
      >
        {impactAlert}
        <Form.Item
          name="key"
          label={keyLabel}
          rules={[{ required: true, message: `请输入${keyLabel}` }]}
        >
          <Input placeholder={keyPlaceholder} disabled={keyDisabled} />
        </Form.Item>
        <Form.Item
          name="remark"
          label={
            <Typography.Text>
              变更说明
              <Typography.Text type="secondary" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                会写入审计历史，便于回溯
              </Typography.Text>
            </Typography.Text>
          }
          rules={[{ required: true, message: '请填写变更说明（写入审计历史）' }]}
        >
          <Input placeholder="例如：双十一调大连接池" maxLength={200} showCount />
        </Form.Item>
        <Form.Item
          name="content"
          label="YAML"
          rules={[{ required: true, message: '请输入 YAML 内容' }]}
        >
          <YamlEditor placeholder={'server:\n  address: ":8000"'} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
