import { describe, expect, it } from 'vitest'
import { cacheKey, loadPageWithCache, type PageCacheStore } from '../src/core/cache'
import type { UniversalPageConfig } from '../src/core/types'

const memStore = (): PageCacheStore => {
  const map = new Map<string, string>()
  return {
    get: (k) => (map.has(k) ? map.get(k)! : null),
    set: (k, v) => { map.set(k, v) },
    remove: (k) => { map.delete(k) },
  }
}

const page = (key: string): UniversalPageConfig => ({
  pageId: `m-${key}`,
  pageKey: key,
  merchantId: 'm',
  status: 'PUBLISHED',
  layout: { title: 'T', components: [{ id: 'a', type: 'Text', props: { content: 'hi' } }] },
})

describe('cacheKey', () => {
  it('namespaces by merchant and page', () => {
    expect(cacheKey('m', 'home')).toBe('fajrina-page:m:home')
  })
})

describe('loadPageWithCache', () => {
  it('returns fresh payload and stores it', async () => {
    const store = memStore()
    const res = await loadPageWithCache(async () => page('home'), 'm', 'home', store)
    expect(res.source).toBe('fresh')
    expect(res.page.pageKey).toBe('home')
    expect(store.get('fajrina-page:m:home')).toContain('"home"')
  })
  it('falls back to last-good on fetch failure', async () => {
    const store = memStore()
    await loadPageWithCache(async () => page('home'), 'm', 'home', store)
    const res = await loadPageWithCache(
      async () => { throw new Error('offline') },
      'm',
      'home',
      store
    )
    expect(res.source).toBe('cache')
    expect(res.page.pageKey).toBe('home')
  })
  it('rethrows when both network and cache miss', async () => {
    await expect(
      loadPageWithCache(async () => { throw new Error('offline') }, 'm', 'missing', memStore())
    ).rejects.toThrow('offline')
  })
  it('does not store invalid payloads', async () => {
    const store = memStore()
    const bad = page('bad')
    ;(bad.layout!.components as unknown[]).push({ id: 'x'.repeat(5000) } as never)
    await loadPageWithCache(async () => bad, 'm', 'bad', store)
    expect(store.get('fajrina-page:m:bad')).toBeNull()
  })
})
