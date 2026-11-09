import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SyncChangeEnvelope } from './sync-client'

vi.mock('@beecount/api-client', () => ({
  API_BASE: '/api/v1',
  authedRawFetch: vi.fn(),
}))

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function page(changes: SyncChangeEnvelope[], cursor: number, hasMore = false) {
  return ok({ changes, server_cursor: cursor, has_more: hasMore })
}

function env(id: number): SyncChangeEnvelope {
  return {
    change_id: id,
    ledger_id: 'l1',
    entity_type: 'transaction',
    entity_sync_id: `s${id}`,
    action: 'update',
    payload: null,
    updated_at: '2026-11-09T00:00:00Z',
  }
}

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

/** pullGuards 是模块单例,每个用例要一份干净的 sync-client + 干净的 fetch mock。 */
async function freshSync() {
  vi.resetModules()
  const api = await import('@beecount/api-client')
  const sync = await import('./sync-client')
  const fetchMock = vi.mocked(api.authedRawFetch)
  // mock 工厂不随 resetModules 重建,spy 上的调用记录会跨用例累积。
  fetchMock.mockReset()
  return { sync, fetchMock }
}

describe('drainPull 单飞锁', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('在飞期间的并发调用被跳过,只发一条请求,由 leader 交付', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() })
    const { sync, fetchMock } = await freshSync()
    const g = gate()
    fetchMock.mockImplementation(async () => page([], 5))
    fetchMock.mockImplementationOnce(async () => {
      await g.promise
      return page([env(1)], 5)
    })

    const leader = sync.drainPull('t', 'u1', null)
    const joined = await sync.drainPull('t', 'u1', null)

    expect(joined).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    g.release()
    const res = await leader
    expect(res?.changes).toEqual([env(1)])
    expect(res?.cursor).toBe(5)
  })

  it('leader 落地后守卫释放,下一次调用照常发请求', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() })
    const { sync, fetchMock } = await freshSync()
    fetchMock.mockImplementation(async () => page([], 5))

    await sync.drainPull('t', 'u1', null)
    const again = await sync.drainPull('t', 'u1', null)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(again).toEqual({ changes: [], cursor: 5 })
  })

  it('has_more 多页 drain 全程占锁,并发调用拿不到半批数据', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    const { sync, fetchMock } = await freshSync()
    const g = gate()
    fetchMock.mockImplementationOnce(async () => {
      await g.promise
      return page([env(1)], 5, true)
    })
    fetchMock.mockImplementationOnce(async () => page([env(2)], 9))

    const leader = sync.drainPull('t', 'u1', null)
    expect(await sync.drainPull('t', 'u1', null)).toBeUndefined()
    g.release()
    const res = await leader

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res?.changes).toEqual([env(1), env(2)])
    expect(res?.cursor).toBe(9)
    expect(storage.getItem('beecount.sync.cursor.u1')).toBe('9')
  })

  it('leader 抛错时并发调用仍拿 undefined,且守卫释放可重试', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() })
    const { sync, fetchMock } = await freshSync()
    fetchMock.mockRejectedValueOnce(new Error('net down'))
    fetchMock.mockImplementation(async () => page([], 0))

    const leader = sync.drainPull('t', 'u1', null)
    const joined = sync.drainPull('t', 'u1', null)

    await expect(leader).rejects.toThrow('net down')
    expect(await joined).toBeUndefined()
    expect(await sync.drainPull('t', 'u1', null)).toEqual({ changes: [], cursor: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('非 OK 响应不前进 cursor,也不把锁留住', async () => {
    const storage = memoryStorage()
    storage.setItem('beecount.sync.cursor.u1', '7')
    vi.stubGlobal('window', { localStorage: storage })
    const { sync, fetchMock } = await freshSync()
    fetchMock.mockImplementationOnce(async () => ok({}, 500))
    fetchMock.mockImplementation(async () => page([], 7))

    expect(await sync.drainPull('t', 'u1', null)).toEqual({ changes: [], cursor: 7 })
    expect(storage.getItem('beecount.sync.cursor.u1')).toBe('7')
    expect(await sync.drainPull('t', 'u1', null)).toEqual({ changes: [], cursor: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('不同 userId 各自一把锁,互不阻塞', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() })
    const { sync, fetchMock } = await freshSync()
    const g = gate()
    fetchMock.mockImplementation(async () => page([], 3))
    fetchMock.mockImplementationOnce(async () => {
      await g.promise
      return page([env(1)], 5)
    })

    const leader = sync.drainPull('t', 'u1', null)
    const other = await sync.drainPull('t', 'u2', null)

    expect(other).toEqual({ changes: [], cursor: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    g.release()
    expect((await leader)?.cursor).toBe(5)
  })

  it('冷启动镜像:poller 首 tick 在飞时,WS onOpen 式补拉被跳过不重复交付', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { localStorage: memoryStorage() })
    const { sync, fetchMock } = await freshSync()
    const g = gate()
    const onChanges = vi.fn()
    fetchMock.mockImplementation(async () => page([], 5))
    fetchMock.mockImplementationOnce(async () => {
      await g.promise
      return page([env(1)], 5)
    })

    const poller = sync.startPoller({ token: 't', userId: 'u1', deviceId: null, onChanges })
    const onOpenPull = sync.drainPull('t', 'u1', null)
    await vi.advanceTimersByTimeAsync(0)

    expect(await onOpenPull).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    g.release()
    await vi.advanceTimersByTimeAsync(0)

    expect(onChanges).toHaveBeenCalledTimes(1)
    expect(onChanges).toHaveBeenCalledWith([env(1)])
    poller.stop()
  })

  it('反方向:外部补拉在飞时 poller 首 tick 跳过,30s 后的 tick 才再拉', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { localStorage: memoryStorage() })
    const { sync, fetchMock } = await freshSync()
    const g = gate()
    const onChanges = vi.fn()
    fetchMock.mockImplementation(async () => page([], 5))
    fetchMock.mockImplementationOnce(async () => {
      await g.promise
      return page([env(1)], 5)
    })

    const leader = sync.drainPull('t', 'u1', null)
    const poller = sync.startPoller({ token: 't', userId: 'u1', deviceId: null, onChanges })
    await vi.advanceTimersByTimeAsync(0)

    expect(onChanges).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    g.release()
    expect((await leader)?.changes).toEqual([env(1)])

    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onChanges).not.toHaveBeenCalled()
    poller.stop()
  })
})