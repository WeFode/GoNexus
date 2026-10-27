import { CloudServerOutlined, LockOutlined, RocketOutlined, SafetyOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons'
import { App, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

interface Values {
  username: string
  password: string
}

const features = [
  { icon: <ThunderboltOutlined />, title: '配置热重载', desc: '保存即推送，服务不重启秒级生效' },
  { icon: <RocketOutlined />, title: '统一发布', desc: '上传一次产物，多节点灰度/全量下发' },
  { icon: <SafetyOutlined />, title: '失败自动回滚', desc: '发布后健康探测，异常自动恢复旧版本' },
]

export function LoginPage() {
  const { message } = App.useApp()
  const { user, login } = useAuth()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/'

  if (user) {
    return <Navigate to={from} replace />
  }

  const onFinish = async (values: Values) => {
    setSubmitting(true)
    try {
      await login(values.username.trim(), values.password)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page flex min-h-full items-stretch">
      <div className="login-brand hidden flex-1 flex-col justify-center gap-10 px-16 lg:flex">
        <div className="flex items-center gap-3">
          <div className="login-logo flex h-11 w-11 items-center justify-center rounded-xl text-xl text-white">
            <CloudServerOutlined />
          </div>
          <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
            配置中心
          </Typography.Title>
        </div>
        <div>
          <Typography.Title style={{ color: 'rgba(255,255,255,0.95)', fontSize: 28, marginTop: 0 }}>
            微服务配置与发布，一个后台全搞定
          </Typography.Title>
          <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16 }}>
            etcd 配置中心 + 统一自动化部署，面向信创达梦环境
          </Typography.Paragraph>
        </div>
        <div className="flex flex-col gap-5">
          {features.map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="login-feat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base">
                {f.icon}
              </div>
              <div>
                <Typography.Text strong style={{ color: '#fff', fontSize: 15 }}>
                  {f.title}
                </Typography.Text>
                <br />
                <Typography.Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>{f.desc}</Typography.Text>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center bg-white p-6 lg:max-w-[520px]">
        <div style={{ width: 340 }}>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white"
              style={{ background: '#1677FF' }}
            >
              <CloudServerOutlined />
            </div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              配置中心
            </Typography.Title>
          </div>
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
            登录
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 28 }}>
            使用管理员分配的账号登录
          </Typography.Paragraph>
          <Form<Values> layout="vertical" onFinish={(v) => void onFinish(v)} autoComplete="on" requiredMark={false}>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" size="large" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8, marginTop: 24 }}>
              <Button type="primary" htmlType="submit" block loading={submitting} size="large">
                登 录
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  )
}
