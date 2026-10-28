import { CloudCogIcon, Loader2Icon, RefreshCwIcon, WifiOffIcon } from 'lucide-react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { useAuth } from './AuthContext'

export function RequireAuth() {
  const { user, booting, bootError, retryBoot, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (booting) {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
            <CloudCogIcon className="size-5" />
          </span>
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2Icon className="size-3.5 animate-spin" />
            正在校验登录状态…
          </span>
        </div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center px-4">
        <div className="bg-card w-full max-w-sm rounded-lg border p-6 text-center">
          <span className="bg-destructive/10 text-destructive mx-auto flex size-10 items-center justify-center rounded-lg">
            <WifiOffIcon className="size-5" />
          </span>
          <h1 className="mt-3 text-base font-semibold">无法连接配置中心服务</h1>
          <p className="text-muted-foreground mt-1 text-xs leading-5 break-words">{bootError}</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">登录凭据已保留，服务恢复后可直接重试。</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={retryBoot}>
              <RefreshCwIcon />
              重试
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                logout()
                navigate('/login', { replace: true })
              }}
            >
              重新登录
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}
