import { Input } from 'antd'
import type { ComponentProps } from 'react'

type TextAreaProps = ComponentProps<typeof Input.TextArea>

export function YamlEditor(props: TextAreaProps) {
  return (
    <Input.TextArea
      {...props}
      className={`yaml-editor ${props.className ?? ''}`}
      autoSize={{ minRows: 14, maxRows: 28 }}
      spellCheck={false}
    />
  )
}
