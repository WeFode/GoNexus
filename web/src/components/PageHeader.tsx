import { Flex, Typography } from 'antd'
import type { ReactNode } from 'react'

interface Props {
  title: string
  extra?: ReactNode
  description?: string
}

export function PageHeader({ title, extra, description }: Props) {
  return (
    <Flex justify="space-between" align="flex-start" className="mb-4" gap={16}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {description ? (
          <Typography.Text type="secondary">{description}</Typography.Text>
        ) : null}
      </div>
      {extra}
    </Flex>
  )
}
