import { afterEach, describe, expect, it, vi } from 'vitest'

type ApiModule = typeof import('@beecount/api-client')

/** 造一张只关心 exp 的假 JWT（客户端不验签，只解 payload 决定要不要提前换票）。 */
function jwt(expInSeconds: number, sub = 'u1'): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, exp: Math.floor(Date.now() / 1000) + expInSeconds })}.sig`
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

function initOf(calls: unknown[][], callIndex = 0): RequestInit {
  return calls[callIndex][1] as RequestInit
}

const mockedFetch = () => vi.fn(async (_input: string, _init: RequestInit) => ok())

/**
 * http.ts 把"最近换出来的那张票"缓存在模块单例里。每个用例都要一份干净的模块
 * 实例，否则上一个用例缓存的票会让下一个用例本该发生的刷新被直接跳过。
 */
async function freshApi(): Promise<ApiModule> {
  vi.resetModules()
  return await import('@beecount/api-client')
}

describe('access token 预刷新', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('快过期时先换票再发请求,整波不再付 401 往返', async () => {
    const { authedGet, configureHttp } = await freshApi()
    const stale = jwt(10)
    const refreshed = jwt(3600)
    const refreshToken = vi.fn(async () => refreshed)
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', stale)

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchMock.mock.calls)).toBe(`Bearer ${refreshed}`)
  })

  it('离过期还远时不刷新,直接用现有 token', async () => {
    const { authedGet, configureHttp } = await freshApi()
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
    const { authedGet, configureHttp } = await freshApi()
    const refreshToken = vi.fn(async () => jwt(3600))
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', 'not-a-jwt')

    expect(refreshToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('预刷新失败时退回旧 token,由 401 兜底逻辑接管', async () => {
    const { authedGet, configureHttp } = await freshApi()
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

describe('换票结果复用(陈旧快照不再各自引发一次刷票)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('同一个旧快照连发多个请求只换一次票,后续都带新票', async () => {
    const { authedGet, authedRawFetch, configureHttp, ensureFreshToken } = await freshApi()
    const stale = jwt(10)
    const refreshed = jwt(3600)
    const refreshToken = vi.fn(async () => refreshed)
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', stale)
    await authedGet('/read/ledgers', stale)
    expect(await ensureFreshToken(stale)).toBe(refreshed)
    await authedRawFetch('http://localhost/api/v1/sync/pull', stale)

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchMock.mock.calls, 1)).toBe(`Bearer ${refreshed}`)
    expect(authHeaderOf(fetchMock.mock.calls, 2)).toBe(`Bearer ${refreshed}`)
  })

  it('不同用户的票不共用缓存,免得把上一个账号的票发给下一个账号', async () => {
    const { authedGet, configureHttp } = await freshApi()
    const refreshToken = vi.fn(async () => jwt(3600, 'whoever'))
    vi.stubGlobal('fetch', mockedFetch())
    configureHttp({ refreshToken })

    await authedGet('/read/ledgers', jwt(10, 'alice'))
    await authedGet('/read/ledgers', jwt(10, 'bob'))

    expect(refreshToken).toHaveBeenCalledTimes(2)
  })

  it('登出时换票缓存作废,新会话会重新换票', async () => {
    const { authedGet, configureHttp } = await freshApi()
    const stale = jwt(10)
    const refreshToken = vi.fn(async () => jwt(3600))
    const logout = vi.fn()
    const fetchMock = vi
      .fn(async (_input: string, _init: RequestInit) => ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken, onLogout: logout })

    await authedGet('/read/ledgers', stale)
    await authedGet('/read/ledgers', stale)
    expect(refreshToken).toHaveBeenCalledTimes(1)

    // 没配换票函数时的 401 走登出分支，缓存必须跟着作废
    configureHttp({ refreshToken: null, onLogout: logout })
    await expect(authedGet('/read/ledgers', stale)).rejects.toBeTruthy()
    expect(logout).toHaveBeenCalledTimes(1)

    configureHttp({ refreshToken, onLogout: logout })
    await authedGet('/read/ledgers', stale)
    expect(refreshToken).toHaveBeenCalledTimes(2)
  })
})

describe('ensureFreshToken(WebSocket 握手复用同一套预刷新)', () => {
  it('票快过期时返回换到的新票,重连不再带死票', async () => {
    const { configureHttp, ensureFreshToken } = await freshApi()
    const stale = jwt(10)
    const refreshed = jwt(3600)
    const refreshToken = vi.fn(async () => refreshed)
    configureHttp({ refreshToken })

    expect(await ensureFreshToken(stale)).toBe(refreshed)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('并发重连共享一次刷新', async () => {
    const { configureHttp, ensureFreshToken } = await freshApi()
    const stale = jwt(10)
    const refreshed = jwt(3600)
    const refreshToken = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(refreshed), 5)
        })
    )
    configureHttp({ refreshToken })

    const results = await Promise.all([ensureFreshToken(stale), ensureFreshToken(stale)])

    expect(results).toEqual([refreshed, refreshed])
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('票还有效时原样返回,不打刷新接口', async () => {
    const { configureHttp, ensureFreshToken } = await freshApi()
    const valid = jwt(3600)
    const refreshToken = vi.fn(async () => jwt(7200))
    configureHttp({ refreshToken })

    expect(await ensureFreshToken(valid)).toBe(valid)
    expect(refreshToken).not.toHaveBeenCalled()
  })

  it('刷新失败时退回旧票,让服务端 403 说话', async () => {
    const { configureHttp, ensureFreshToken } = await freshApi()
    const stale = jwt(10)
    configureHttp({ refreshToken: vi.fn(async () => { throw new Error('no refresh token') }) })

    expect(await ensureFreshToken(stale)).toBe(stale)
  })
})

describe('authedRawFetch(下载/上传/SSE 的统一鉴权通道)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('保留调用方 header,但 Authorization 由本模块注入', async () => {
    const { authedRawFetch, configureHttp } = await freshApi()
    const valid = jwt(3600)
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken: vi.fn(async () => jwt(7200)) })

    const res = await authedRawFetch('http://localhost/api/v1/ai/ask', valid, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: 'Bearer 调用方手拼的旧票'
      },
      body: '{"q":1}'
    })

    expect(res.ok).toBe(true)
    const headers = initOf(fetchMock.mock.calls).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Accept).toBe('text/event-stream')
    expect(headers.Authorization).toBe(`Bearer ${valid}`)
    expect(initOf(fetchMock.mock.calls).body).toBe('{"q":1}')
  })

  it('401 时换票并用同一个请求重放', async () => {
    const { authedRawFetch, configureHttp } = await freshApi()
    const url = 'http://localhost/api/v1/import/upload'
    const refreshToken = vi.fn(async () => jwt(7200))
    const fetchMock = vi
      .fn(async (_input: string, _init: RequestInit) => ok())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    const res = await authedRawFetch(url, jwt(3600), { method: 'POST', body: 'form-data' })

    expect(res.ok).toBe(true)
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe(url)
    expect(initOf(fetchMock.mock.calls, 1).body).toBe('form-data')
  })

  it('票快过期时先换票,一次就打中', async () => {
    const { authedRawFetch, configureHttp } = await freshApi()
    const stale = jwt(10)
    const refreshed = jwt(3600)
    const refreshToken = vi.fn(async () => refreshed)
    const fetchMock = mockedFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureHttp({ refreshToken })

    await authedRawFetch('http://localhost/api/v1/sync/pull', stale)

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchMock.mock.calls)).toBe(`Bearer ${refreshed}`)
  })
})
