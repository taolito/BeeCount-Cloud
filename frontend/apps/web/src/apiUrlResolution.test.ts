import { afterEach, describe, expect, it, vi } from 'vitest'

import { deployPrefixOf, resolveApiUrl } from '@beecount/api-client'

const ORIGIN = 'https://luckyluck.top'

// vitest 里 VITE_BASE_PATH 是 vite define 编译期注入的 '/'，所以 API_BASE
// 固定是 /api/v1 —— 正好覆盖「根路径部署」这条线；子路径的前缀推导单独测
// deployPrefixOf，两段合起来就是 resolveApiUrl 的完整行为。
describe('deployPrefixOf', () => {
  it('从 API base 反推部署子路径', () => {
    expect(deployPrefixOf(`${ORIGIN}/bookkeep/api/v1`)).toBe('/bookkeep')
    expect(deployPrefixOf(`${ORIGIN}/api/v1`)).toBe('')
    expect(deployPrefixOf('https://api.example.com/v1')).toBe('')
    expect(deployPrefixOf('not a url')).toBe('')
  })
})

describe('resolveApiUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function withOrigin() {
    vi.stubGlobal('window', { location: { origin: ORIGIN } })
  }

  it('根部署下保留后端下发的根绝对路径', () => {
    withOrigin()
    expect(resolveApiUrl('/api/v1/profile/avatar/u1?v=3')).toBe(
      `${ORIGIN}/api/v1/profile/avatar/u1?v=3`,
    )
  })

  it('裸相对路径按 API base 的所在目录解析（既有行为，调用方并不传这种值）', () => {
    withOrigin()
    // API_BASE 是 '/api/v1' 且无尾斜杠，WHATWG URL 会把它当文件名丢掉 'v1'。
    expect(resolveApiUrl('profile/avatar/u1')).toBe(`${ORIGIN}/api/profile/avatar/u1`)
  })

  it('完整 URL 与空值原样透传', () => {
    withOrigin()
    expect(resolveApiUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(resolveApiUrl('')).toBeNull()
    expect(resolveApiUrl(null)).toBeNull()
  })
})
