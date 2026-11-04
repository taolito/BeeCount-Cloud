import { afterEach, describe, expect, it, vi } from 'vitest'

import { authedGet, configureHttp } from '@beecount/api-client'

/** 造一张只关心 exp 的假 JWT（客户端不验签，只解 payload 决定要不要提前换票）。 */
function jwt(expInSeconds: number): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + expInSeconds })}.sig`
}

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function unauthorized() {
  return new Response('{}', { status: 401 })
}

/** 取第 n 次 fetch 实际带出去的 Authorization 头。 */
function authHeaderOf(calls: unknown[][], callIndex = 0): string {
  const [, init] = calls[callIndex] as [string, RequestInit]
  return (init.headers as Record<string, string>).Authorization
}

const mockedFetch = () =>
  vi.fn(async (_input: string, _init: RequestInit) => ok())

describe('access token 预刷新', () => {
  afterEach(() => {
    configureHttp({ refreshToken: null, onLogout: null })
    vi.unstubAllGlobals()
  })

  it('快过期时先换票再发请求,整波不再付 401 往返', async () => {
    const stale = jwt(10)
    const fresh = jwt(3600)
    const refreshToken = vi.fn(async () => fresh)
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', stale)

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchMock.mock.calls)).toBe(`Bearer ${fresh}`)
  })

  it('离过期还远时不刷新,直接用现有 token', async () => {
    const valid = jwt(3600)
    const refreshToken = vi.fn(async () => jwt(7200))
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', valid)

    expect(refreshToken).not.toHaveBeenCalled()
    expect(authHeaderOf(fetchMock.mock.calls)).toBe(`Bearer ${valid}`)
  })

  it('解不出 exp 的 token 不当作过期处理', async () => {
    const refreshToken = vi.fn(async () => jwt(3600))
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', 'not-a-jwt')

    expect(refreshToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('预刷新失败时退回旧 token,由 401 兜底逻辑接管', async () => {
    const stale = jwt(10)
    const refreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('refresh endpoint down'))
      .mockResolvedValue(jwt(3600))
    const fetchMock = vi
      .fn(async (_input: string, _init: RequestInit) => ok())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', stale)

    // 第一次用旧票发出(预刷新失败)→ 401 → 单飞刷新 → 重放成功
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(authHeaderOf(fetchMock.mock.calls, 0)).toBe(`Bearer ${stale}`)
    expect(authHeaderOf(fetchMock.mock.calls, 1)).not.toBe(`Bearer ${stale}`)
  })
})
