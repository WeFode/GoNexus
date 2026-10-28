import { clearToken, getToken } from '../auth/session'

export class ApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

interface GfResponse<T> {
  code: number
  message: string
  data: T
}

function redirectLogin() {
  if (window.location.pathname === '/login') return
  clearToken()
  window.location.href = '/login'
}

async function parse<T>(res: Response, path: string): Promise<T> {
  const raw = await res.text()
  let json: GfResponse<T> | null = null
  if (raw) {
    try {
      json = JSON.parse(raw) as GfResponse<T>
    } catch {
      json = null
    }
  }

  // 网关/代理挂了时返回的是空体或 HTML，不能把 JSON 解析异常直接抛给用户
  if (!json) {
    if (res.status >= 500) {
      throw new ApiError(res.status, `服务暂不可用（HTTP ${res.status}），请确认 configure-server 已启动`)
    }
    throw new ApiError(res.status, `请求失败（HTTP ${res.status}）`)
  }

  if (res.status === 401 || json.code === 401) {
    if (!path.includes('/auth/login')) {
      redirectLogin()
    }
    throw new ApiError(401, json.message || '未登录或登录已过期')
  }
  if (!res.ok || json.code !== 0) {
    throw new ApiError(json.code ?? res.status, json.message || res.statusText)
  }
  return json.data
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  if (init?.body && !headers.has('Content-Type') && !isForm) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(path, { ...init, headers })
  return parse<T>(res, path)
}
