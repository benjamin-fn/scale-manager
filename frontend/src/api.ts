import { useEffect, useState } from 'react'

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
const errorCodes: Record<string, string> = { login: 'badLogin', status: 'badStatus', customer: 'badCustomer', campaign: 'badCampaign' }

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const fallback = ({ 401: 'access', 403: 'access', 404: 'notFound', 400: 'invalid', 429: 'rateLimited' } as Record<number, string>)[response.status] ?? 'error'
    throw new ApiError(response.status, errorCodes[body?.code] ?? body?.code ?? fallback)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export async function write<T = void>(path: string, method: string, data?: unknown) {
  const { token } = await request<{ token: string }>('/csrf')
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
}

export function useApi<T>(path: string | null, revision = 0) {
  const [state, setState] = useState<{ path: string | null; revision: number; data?: T; error?: Error }>({ path: null, revision })
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    request<T>(path, { signal: controller.signal }).then(
      data => setState({ path, revision, data }),
      error => { if (!controller.signal.aborted) setState({ path, revision, error }) },
    )
    return () => controller.abort()
  }, [path, revision])
  return state.path === path && state.revision === revision ? state : { data: undefined, error: undefined }
}
export type Row = { id: number | string; [key: string]: string | number | boolean | null | undefined }
export type User = { id: string; name: string; email: string; role: 'Admin' | 'Manager' | 'Employee'; demo: boolean }
export type Activity = { id: number; subject: string; action: string; date: string; kind: string; recordId: number }
export const errorKey = (error: unknown) => error instanceof ApiError ? error.code : 'error'
export const canManage = (user: User) => user.role !== 'Employee'
export const utcDate = () => new Date().toISOString().slice(0, 10)

