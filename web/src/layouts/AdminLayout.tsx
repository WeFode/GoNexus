import {
  ClusterOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Badge, Button, Dropdown, Flex, Layout, Menu, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { listDeployJobs } from '../api/deploy'

const { Sider, Header, Content } = Layout

const groups = [
  {
    key: 'g1',
    type: 'group' as const,
    label: '总览',
    children: [{ key: '/', icon: <DashboardOutlined />, label: '概览' }],
  },
  {
    key: 'g2',
    type: 'group' as const,
    label: '配置管理',
    children: [
      { key: '/shared', icon: <SafetyCertificateOutlined />, label: '公共配置' },
      { key: '/services', icon: <ClusterOutlined />, label: '服务配置' },
    ],
  },
  {
    key: 'g3',
    type: 'group' as const,
    label: '发布与节点',
    children: [
      { key: '/deploys', icon: <RocketOutlined />, label: '发布' },
      { key: '/nodes', icon: <CloudServerOutlined />, label: '节点' },
    ],
  },
]

const titles: Record<string, { title: string; desc: string }> = {
  '/': { title: '概览', desc: '配置与发布的运行状态总览' },
  '/shared': { title: '公共配置', desc: '所有微服务共享，变更将热推送至全部服务' },
  '/services': { title: '服务配置', desc: '各微服务专属配置，覆盖同名公共项' },
  '/deploys': { title: '发布', desc: '上传产物，一键灰度或全量发布到多节点' },
  '/nodes': { title: '节点', desc: 'deploy-agent 心跳上报的机器与容器' },
}

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [activeJobs, setActiveJobs] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const jobs = await listDeployJobs()
        if (!stop) {
          setActiveJobs(jobs.filter((j) => ['pending', 'waiting', 'running'].includes(j.status)).length)
        }
      } catch {
        /* 静默：导航徽标失败不打扰用户 */
      }
    }
    void tick()
    const t = setInterval(() => void tick(), 10000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  const selected = useMemo(() => {
    const hit = ['/shared', '/services', '/nodes', '/deploys'].find((k) => location.pathname.startsWith(k))
    return [hit ?? '/']
  }, [location.pathname])

  const meta = titles[selected[0]] ?? titles['/']

  const badgeGroups = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        children: g.children.map((item) =>
          item.key === '/deploys' && activeJobs > 0 && !collapsed
            ? { ...item, label: <Flex align="center" justify="space-between">{item.label}<Badge count={activeJobs} size="small" /></Flex> }
            : item.key === '/deploys' && activeJobs > 0
              ? { ...item, icon: <Badge count={activeJobs} size="small" offset={[2, -2]}>{item.icon}</Badge> }
              : item,
        ),
      })),
    [activeJobs, collapsed],
  )

  return (
    <Layout className="min-h-full">
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        theme="light"
        width={216}
        className="border-r border-solid"
        style={{ borderColor: '#F0F0F0' }}
      >
        <div
          className="flex h-14 cursor-pointer items-center gap-2 px-4"
          onClick={() => navigate('/')}
          title="回到概览"
        >
          {/* <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: 'linear-gradient(135deg, #0b4da2, #1677ff)' }}
          >
            C
          </div> */}
          {!collapsed ? (
            <Flex vertical>
              <Typography.Text strong className="truncate">
                配置中心
              </Typography.Text>
            </Flex>
          ) : null}
        </div>
        <Menu
          mode="inline"
          selectedKeys={selected}
          items={badgeGroups}
          onClick={({ key }) => navigate(key)}
          style={{ border: 0, paddingInline: 8 }}
        />
        {!collapsed ? (
          <Typography.Text
            type="secondary"
            style={{ display: 'block', padding: '12px 24px', fontSize: 12 }}
          >
            etcd 配置中心 · 统一发布
          </Typography.Text>
        ) : null}
      </Sider>
      <Layout>
        <Header
          className="flex items-center justify-between border-b border-solid"
          style={{ borderColor: '#F0F0F0' }}
        >
          <Flex align="center" gap={12}>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-base"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? '展开菜单' : '收起菜单'}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            <Flex vertical>
              <Typography.Text strong>{meta.title}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {meta.desc}
              </Typography.Text>
            </Flex>
          </Flex>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'user',
                  label: (
                    <Flex align="center" gap={8}>
                      <UserOutlined />
                      <span>{user?.username}</span>
                      <Tag color={user?.role === 'admin' ? 'blue' : 'default'}>
                        {user?.role === 'admin' ? '管理员' : '运营'}
                      </Tag>
                    </Flex>
                  ),
                  disabled: true,
                },
                { type: 'divider' },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: () => {
                    logout()
                    navigate('/login', { replace: true })
                  },
                },
              ],
            }}
          >
            <Button type="text" icon={<UserOutlined />} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {user?.username}
              <Tag color={user?.role === 'admin' ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                {user?.role === 'admin' ? '管理员' : '运营'}
              </Tag>
            </Button>
          </Dropdown>
        </Header>
        <Content className="p-6">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
