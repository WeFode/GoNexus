import { request } from './client'

export interface LoginRes {
  token: string
  expireAt: string
  username: string
  role: 'admin' | 'operator' | string
}

export interface MeRes {
  username: string
  role: 'admin' | 'operator' | string
}

export function login(username: string, password: string) {
  return request<LoginRes>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function getMe() {
  return request<MeRes>('/api/v1/auth/me')
}
