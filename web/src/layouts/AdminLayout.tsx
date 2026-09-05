import {
  ClusterOutlined,
  DatabaseOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  LogoutOutlined,
  CloudServerOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { Button, Flex, Layout, Menu, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const { Header, Sider, Content } = Layout

const items = [
  { key: '/', icon: <DashboardOutlined />, label: '概览' },
  { key: '/shared', icon: <DatabaseOutlined />, label: '公共配置' },
  { key: '/services', icon: <ClusterOutlined />, label: '服务配置' },
  { key: '/nodes', icon: <CloudServerOutlined />, label: '节点' },
  { key: '/deploys', icon: <RocketOutlined />, label: '发布' },
]

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const selected = useMemo(() => {
    const hit = items.find((i) => i.key !== '/' && location.pathname.startsWith(i.key))
    return [hit?.key ?? '/']
  }, [location.pathname])

  return (
    <Layout className="min-h-full">
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        theme="light"
        width={220}
        className="border-r border-solid"
        style={{ borderColor: '#F0F0F0' }}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white"
            style={{ background: '#1677FF' }}
          >
            C
          </div>
          {!collapsed ? (
            <Typography.Text strong className="truncate">
              配置中心
            </Typography.Text>
          ) : null}
        </div>
        <Menu
          mode="inline"
          selectedKeys={selected}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="flex items-center justify-between border-b border-solid" style={{ borderColor: '#F0F0F0' }}>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-base"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? '展开菜单' : '收起菜单'}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
          <Flex align="center" gap={12}>
            <Typography.Text>{user?.username}</Typography.Text>
            <Tag>{user?.role === 'admin' ? '管理员' : '运营'}</Tag>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                logout()
                navigate('/login', { replace: true })
              }}
            >
              退出
            </Button>
          </Flex>
        </Header>
        <Content className="p-6">
          <div className="rounded-lg bg-white p-6" style={{ minHeight: 'calc(100vh - 56px - 48px)' }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
