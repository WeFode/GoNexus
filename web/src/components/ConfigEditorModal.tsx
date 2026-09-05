import { Form, Input, Modal } from 'antd'
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
  onCancel,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<ConfigEditorValues>()

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      width={720}
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
        <Form.Item
          name="key"
          label={keyLabel}
          rules={[{ required: true, message: `请输入${keyLabel}` }]}
        >
          <Input placeholder={keyPlaceholder} disabled={keyDisabled} />
        </Form.Item>
        <Form.Item name="remark" label="变更说明">
          <Input placeholder="例如：双十一调大连接池" />
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
