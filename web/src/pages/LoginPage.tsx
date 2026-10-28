import { useState } from 'react'
import {
  CloudCogIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  LockIcon,
  RocketIcon,
  ShieldCheckIcon,
  UserIcon,
  ZapIcon,
} from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { notifyError } from '../lib/notify'

const features = [
  { icon: ZapIcon, title: '配置热重载', desc: '保存即推送，服务不重启秒级生效' },
  { icon: RocketIcon, title: '统一发布', desc: '上传一次产物，多节点灰度 / 全量下发' },
  { icon: ShieldCheckIcon, title: '失败自动回滚', desc: '发布后健康探测，异常自动恢复旧版本' },
]

interface FieldErrors {
  username?: string
  password?: string
}

export function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/'

  if (user) {
    return <Navigate to={from} replace />
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next: FieldErrors = {}
    if (!username.trim()) next.username = '请输入用户名'
    if (!password) next.password = '请输入密码'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      await login(username.trim(), password)
    } catch (error) {
      notifyError(error, '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-12 text-zinc-100 lg:flex dark:border-r dark:border-white/10 dark:bg-zinc-900">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-44 -right-24 size-[520px] rounded-full bg-white/[0.07] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-44 -left-24 size-[420px] rounded-full bg-white/[0.04] blur-3xl"
        />

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <CloudCogIcon className="size-5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">配置中心</span>
          </div>

          <h2 className="mt-16 max-w-lg text-[32px] leading-[1.25] font-semibold tracking-tight">
            微服务配置与发布
            <br />
            一个后台全搞定
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">
            etcd 配置中心 + 统一自动化部署，配置秒级热加载，发布失败自动回滚。
          </p>

          <ul className="mt-10 space-y-5">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <li key={feature.title} className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-zinc-200 ring-1 ring-white/10">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{feature.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{feature.desc}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <p className="relative text-xs text-zinc-400">etcd watch · Docker 发布 · 健康探测与自动回滚</p>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[344px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
              <CloudCogIcon className="size-5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">配置中心</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">使用管理员分配的账号登录</p>

          <form className="mt-8 space-y-4" onSubmit={(event) => void onSubmit(event)} autoComplete="on">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <div className="relative">
                <UserIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="username"
                  value={username}
                  autoComplete="username"
                  placeholder="用户名"
                  className="h-10 pl-9"
                  aria-invalid={Boolean(errors.username)}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    if (errors.username) setErrors((prev) => ({ ...prev, username: undefined }))
                  }}
                />
              </div>
              {errors.username ? <p className="text-destructive text-xs">{errors.username}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <LockIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  placeholder="密码"
                  className="h-10 pr-10 pl-9"
                  aria-invalid={Boolean(errors.password)}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              </div>
              {errors.password ? <p className="text-destructive text-xs">{errors.password}</p> : null}
            </div>

            <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting}>
              {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
              登录
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 text-xs leading-5">
            账户来自 configure-server 的用户表；登录失败请检查服务端 auth 日志。
          </p>
        </div>
      </div>
    </div>
  )
}
