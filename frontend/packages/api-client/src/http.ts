import { extractApiError } from './errors'
import { appUrl } from './app-base'

// 未显式配置时跟随部署前缀（子路径 → /bookkeep/api/v1，根路径 → /api/v1）。
export const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || appUrl('api/v1')

function resolveApiBaseUrl(): string | null {
  const normalized = `${API_BASE || ''}`.trim()
  if (!normalized) return null
  try {
    return new URL(normalized).toString()
  } catch (_) {
    if (typeof window === 'undefined') return null
    try {
      return new URL(normalized, window.location.origin).toString()
    } catch (_) {
      return null
    }
  }
}

// 后端拼 URL 时用的是自己的 settings.api_prefix,不带部署子路径。
const SERVER_API_PREFIX = '/api/v1'

/** 从 API base 反推部署前缀:`/bookkeep/api/v1` → `/bookkeep`,根部署 → ''。 */
export function deployPrefixOf(apiBase: string): string {
  try {
    const pathname = new URL(apiBase).pathname
    return pathname.endsWith(SERVER_API_PREFIX)
      ? pathname.slice(0, -SERVER_API_PREFIX.length)
      : ''
  } catch (_) {
    return ''
  }
}

export function resolveApiUrl(value?: string | null): string | null {
  const normalized = `${value || ''}`.trim()
  if (!normalized) return null
  try {
    return new URL(normalized).toString()
  } catch (_) {
    const base = resolveApiBaseUrl()
    if (!base) return normalized
    // 头像/附件这类 URL 是后端下发的根绝对路径(/api/v1/profile/avatar/x)。
    // `new URL('/api/v1/...', base)` 只取 base 的 origin,子路径部署会把
    // /bookkeep 前缀吃掉 → 图片 404。先把部署前缀补回去再解析。
    const candidate = normalized.startsWith(SERVER_API_PREFIX)
      ? `${deployPrefixOf(base)}${normalized}`
      : normalized
    try {
      return new URL(candidate, base).toString()
    } catch (_) {
      return normalized
    }
  }
}

// ---------------------------------------------------------------------------
// Auth token coordination
// ---------------------------------------------------------------------------
//
// Without a global 401 handler every caller has to remember to check for
// ``status === 401`` and trigger a logout. In practice they don't, which means
// one expired token mid-session leaves the UI half-alive: reads fail silently,
// writes succeed until the next refresh. This module centralizes the retry:
// call sites keep passing the old token; if the server rejects it, we do a
// single-flight refresh here and replay the request transparently.

type RefreshFn = () => Promise<string>
type LogoutFn = () => void

let refreshFn: RefreshFn | null = null
let logoutFn: LogoutFn | null = null
let refreshInFlight: Promise<string> | null = null

/**
 * Wire the http layer to app-level auth callbacks. Call once after login
 * succeeds; no-op safe to call repeatedly.
 */
export function configureHttp(opts: { refreshToken?: RefreshFn | null; onLogout?: LogoutFn | null }): void {
  refreshFn = opts.refreshToken ?? null
  logoutFn = opts.onLogout ?? null
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw await extractApiError(res)
  }
  // 204 No Content 或 Content-Length: 0 的响应 (DELETE 撤销/删除 PAT 这种)
  // 没有 body,直接 `res.json()` 会抛 `Unexpected end of JSON input`。返
  // `undefined as T` —— 调用方签名是 `Promise<void>` 时 OK,期望 JSON
  // 的调用方本来就不会发出 204 请求。
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json()
}

/**
 * 公开 GET(无 Authorization header),目前用于 /version 这种不敏感且
 * 未登录也应该能打到的端点。
 */
export async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  })
  return parseResponse<T>(res)
}

export type BeeCountCloudVersion = {
  name: string
  version: string
}

export async function fetchCloudVersion(): Promise<BeeCountCloudVersion> {
  return publicGet<BeeCountCloudVersion>('/version')
}

/** 取当前浏览器 localStorage 存的 device_id(login 时落盘)。服务端鉴权中间件
 *  根据这个 header bump Device.last_seen_at,让"设备页最近活跃时间"真实反映
 *  web 操作而非"上次登录时间"。延迟 require 防止 auth.ts / http.ts 循环依赖。*/
function currentDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    // 跟 auth.ts 的 DEVICE_ID_KEY 同名同义,复制避免循环 import
    return window.localStorage.getItem(`beecount.web.device_id.${API_BASE}`)
  } catch {
    return null
  }
}

function authHeaders(token: string, idempotencyKey?: string): Record<string, string> {
  const out: Record<string, string> = {
    Authorization: `Bearer ${token}`
  }
  if (idempotencyKey) out['Idempotency-Key'] = idempotencyKey
  const deviceId = currentDeviceId()
  if (deviceId) out['X-Device-ID'] = deviceId
  return out
}

async function doRefresh(): Promise<string> {
  if (!refreshFn) throw new Error('no refresh configured')
  if (!refreshInFlight) {
    refreshInFlight = refreshFn().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

type FetchMaker = (token: string) => Promise<Response>

/** access token 的 exp（毫秒）。只解 payload 不验签 —— 服务端才是权威，这里
 *  只用来决定"要不要提前换一张"，解不出来就当不过期。 */
function tokenExpiresAtMs(token: string): number | null {
  const segments = `${token || ''}`.split('.')
  if (segments.length !== 3) return null
  try {
    const payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
  } catch (_) {
    return null
  }
}

// 提前 60s 换票：页面冷启动时 localStorage 里的票常常已经过期，20 个请求会
// 全部先 401 → 单飞刷新 → 重放，整波多付一个往返（WebSocket 握手同理，直接 403）。
const REFRESH_SKEW_MS = 60_000

async function tokenForRequest(token: string): Promise<string> {
  if (!refreshFn) return token
  const expiresAt = tokenExpiresAtMs(token)
  if (!expiresAt || expiresAt - Date.now() > REFRESH_SKEW_MS) return token
  try {
    return await doRefresh()
  } catch (_) {
    // 换票失败就用旧票正常发出去，让 401 兜底逻辑决定是不是该登出。
    return token
  }
}

/**
 * Perform an authed fetch with transparent single-flight token refresh on 401.
 * Callers provide a factory that builds the request given the current token
 * string so we can replay the call with a refreshed token.
 */
async function authedFetch(makeRequest: FetchMaker, token: string): Promise<Response> {
  const res = await makeRequest(await tokenForRequest(token))
  if (res.status !== 401) return res
  // Drain the body so we don't leak the connection on node/fetch implementations.
  try {
    await res.text()
  } catch (_) {
    // ignore
  }
  if (!refreshFn) {
    // No refresh path configured — surface 401 so caller logs out explicitly.
    logoutFn?.()
    return res
  }
  try {
    const fresh = await doRefresh()
    return await makeRequest(fresh)
  } catch (_) {
    logoutFn?.()
    return res
  }
}

export async function authedGet<T>(path: string, token: string): Promise<T> {
  const res = await authedFetch(
    (tok) =>
      fetch(`${API_BASE}${path}`, {
        headers: authHeaders(tok),
        // 数据是事件日志 + 最新快照驱动的，任何缓存命中都会让 refresh-after-write
        // 看到上一份数据。显式拒绝，避免浏览器/中间 CDN 给同路径返回旧响应。
        cache: 'no-store'
      }),
    token
  )
  return parseResponse<T>(res)
}

export async function authedPost<T>(
  path: string,
  token: string,
  body: unknown,
  idempotencyKey?: string
): Promise<T> {
  const res = await authedFetch(
    (tok) =>
      fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          ...authHeaders(tok, idempotencyKey),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
    token
  )
  return parseResponse<T>(res)
}

export async function authedPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await authedFetch(
    (tok) =>
      fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
          ...authHeaders(tok),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
    token
  )
  return parseResponse<T>(res)
}

export async function authedPut<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await authedFetch(
    (tok) =>
      fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
          ...authHeaders(tok),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
    token
  )
  return parseResponse<T>(res)
}

export async function authedDelete<T>(path: string, token: string, body?: unknown): Promise<T> {
  const hasBody = typeof body !== 'undefined'
  const res = await authedFetch(
    (tok) =>
      fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        headers: hasBody
          ? {
              ...authHeaders(tok),
              'Content-Type': 'application/json'
            }
          : authHeaders(tok),
        body: hasBody ? JSON.stringify(body) : undefined
      }),
    token
  )
  return parseResponse<T>(res)
}
