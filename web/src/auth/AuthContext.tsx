import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, login as loginApi, type MeRes } from '../api/auth'
import { ApiError } from '../api/client'
import { errorMessage } from '../lib/notify'
import { clearToken, getToken, setToken } from './session'

interface AuthValue {
  user: MeRes | null
  booting: boolean
  /** 启动校验遇到非 401 错误（后端未启动、网络抖动）时保留 token，让用户重试 */
  bootError: string
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  retryBoot: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeRes | null>(null)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState('')

  const boot = useCallback(async () => {
    if (!getToken()) {
      setBooting(false)
      setBootError('')
      return
    }
    setBooting(true)
    setBootError('')
    try {
      setUser(await getMe())
    } catch (error) {
      // 只有明确未授权才清 token；后端重启或网络抖动不应把用户登出
      if (error instanceof ApiError && error.code === 401) {
        clearToken()
        setUser(null)
      } else {
        setBootError(errorMessage(error, '无法连接 configure-server'))
      }
    } finally {
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  const login = useCallback(async (username: string, password: string) => {
    const res = await loginApi(username, password)
    setToken(res.token)
    setUser({ username: res.username, role: res.role })
    setBootError('')
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setBootError('')
  }, [])

  const value = useMemo(
    () => ({ user, booting, bootError, login, logout, retryBoot: () => void boot() }),
    [user, booting, bootError, login, logout, boot],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
