import {
  ActivityIcon,
  BoxesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloudCogIcon,
  Code2Icon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftIcon,
  RocketIcon,
  ServerIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { listDeployJobs } from '../api/deploy'
import { useAuth } from '../auth/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Separator } from '../components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'

const COLLAPSE_KEY = 'cc-sidebar-collapsed'

const navGroups: { label: string; items: { to: string; label: string; icon: LucideIcon; end?: boolean }[] }[] = [
  {
    label: '总览',
    items: [
      { to: '/', label: '概览', icon: LayoutDashboardIcon, end: true },
      { to: '/observability', label: '可观测', icon: ActivityIcon },
      { to: '/service-logs', label: '服务日志', icon: Code2Icon },
    ],
  },
  {
    label: '配置管理',
    items: [
      { to: '/shared', label: '公共配置', icon: ShieldCheckIcon },
      { to: '/services', label: '服务配置', icon: ServerIcon },
    ],
  },
  {
    label: '发布与节点',
    items: [
      { to: '/deploys', label: '发布', icon: RocketIcon },
      { to: '/nodes', label: '节点', icon: BoxesIcon },
    ],
  },
]

function isActive(pathname: string, to: string, end?: boolean) {
  if (end) return pathname === to
  return pathname === to || pathname.startsWith(`${to}/`)
}

interface SidebarNavProps {
  collapsed: boolean
  activeJobs: number
  onNavigate?: () => void
}

function SidebarNav({ collapsed, activeJobs, onNavigate }: SidebarNavProps) {
  const { pathname } = useLocation()

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b px-4', collapsed && 'justify-center px-0')}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CloudCogIcon className="size-4" />
        </span>
        {!collapsed ? <span className="truncate text-sm font-semibold tracking-tight">配置中心</span> : null}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {!collapsed ? (
              <div className="px-2 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {group.label}
              </div>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.to, item.end)
                const showJobs = item.to === '/deploys' && activeJobs > 0
                const Icon = item.icon
                const link = (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    className={cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
                      active
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    <span className="relative flex shrink-0 items-center">
                      <Icon className="size-4" />
                      {showJobs && collapsed ? (
                        <span className="bg-success absolute -top-0.5 -right-1 size-1.5 rounded-full" />
                      ) : null}
                    </span>
                    {!collapsed ? (
                      <>
                        <span className="truncate">{item.label}</span>
                        {showJobs ? (
                          <span className="bg-muted text-muted-foreground ml-auto rounded-full px-1.5 text-[11px] leading-4 font-medium tabular-nums">
                            {activeJobs}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </NavLink>
                )

                if (!collapsed) return link
                return (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed ? (
        <div className="shrink-0 border-t px-4 py-3 text-[11px] leading-4 text-muted-foreground">
          etcd 配置中心 · 统一发布
          <br />
          配置变更 1 秒内热加载
        </div>
      ) : null}
    </div>
  )
}

function useActiveJobs() {
  const [activeJobs, setActiveJobs] = useState(0)

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const jobs = await listDeployJobs()
        if (!stop) {
          setActiveJobs(jobs.filter((job) => ['pending', 'waiting', 'running'].includes(job.status)).length)
        }
      } catch {
        /* 静默：导航徽标失败不打扰用户 */
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 10_000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [])

  return activeJobs
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const activeJobs = useActiveJobs()

  const current = useMemo(() => {
    for (const group of navGroups) {
      const hit = group.items.find((item) => isActive(pathname, item.to, item.end))
      if (hit) return { group: group.label, item: hit.label }
    }
    return { group: '总览', item: '概览' }
  }, [pathname])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* 存不下不影响本次折叠 */
      }
      return next
    })
  }

  const isAdmin = user?.role === 'admin'
  const initial = user?.username?.slice(0, 1).toUpperCase() ?? 'U'

  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside
        className={cn(
          'hidden shrink-0 border-r transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarNav collapsed={collapsed} activeJobs={activeJobs} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>导航菜单</SheetTitle>
            <SheetDescription>配置中心功能导航</SheetDescription>
          </SheetHeader>
          <SidebarNav collapsed={false} activeJobs={activeJobs} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b px-3 sm:px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="打开导航菜单"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden lg:inline-flex"
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                onClick={toggleCollapsed}
              >
                <PanelLeftIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{collapsed ? '展开侧栏' : '收起侧栏'}</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 hidden h-4 lg:block" />

          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{current.group}</span>
            <ChevronRightIcon className="text-muted-foreground/60 hidden size-3.5 sm:inline" />
            <span className="truncate font-medium">{current.item}</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Separator orientation="vertical" className="mx-1 h-4" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-2 px-1.5">
                  <Avatar className="size-6">
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-[11px] font-semibold">
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 truncate text-sm sm:inline">{user?.username}</span>
                  <ChevronDownIcon className="text-muted-foreground size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-semibold">
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{user?.username}</span>
                    <span className="text-muted-foreground text-xs">{isAdmin ? '管理员' : '运营'}</span>
                  </span>
                  <Badge variant={isAdmin ? 'secondary' : 'outline'} className="ml-auto">
                    {isAdmin ? 'admin' : 'operator'}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onLogout} className="gap-2">
                  <LogOutIcon className="size-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
