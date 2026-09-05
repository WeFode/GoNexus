import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, login as loginApi, type MeRes } from '../api/auth'
import { clearToken, getToken, setToken } from './session'

interface AuthValue {
  user: MeRes | null
  booting: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeRes | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setBooting(false)
      return
    }
    void getMe()
      .then(setUser)
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => setBooting(false))
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await loginApi(username, password)
    setToken(res.token)
    setUser({ username: res.username, role: res.role })
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, booting, login, logout }), [user, booting, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
