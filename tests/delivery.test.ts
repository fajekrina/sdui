// F1 (HLD Target): spec screen delivery — specScreenProvider / specManifestLoader and the
// manifest version reaching the provider, so a versioned (immutable) URL is fetched.
import { describe, expect, it, vi } from 'vitest'
import { specManifestLoader, specScreenProvider } from '../src/browser'
import { MemoryCacheStore, ScreenSource, SduiCache } from '../src/core'
import { devEngine } from './helpers'

const screen = (key: string, text = 'hi') => ({ schemaVersion: '1.1', screen: { key, root: { type: 'text', props: { value: text } } } })
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('specScreenProvider', () => {
  it('GET {basePath}/screens/{mid}/{key}, or …/{version} when the manifest names one', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => ok(screen('home')))
    const factory = specScreenProvider({ basePath: '/api/universal/v1/client/', merchantId: 'merchant demo', fetchImpl })
    await factory.data('home')
    await factory.data('home', { version: 'v17' })
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      '/api/universal/v1/client/screens/merchant%20demo/home',
      '/api/universal/v1/client/screens/merchant%20demo/home/v17'
    ])
    const init = fetchImpl.mock.calls[0]![1]!
    expect(init.credentials).toBe('same-origin')
    expect(init.headers).toEqual({ Accept: 'application/json' })
  })

  it('sends trace headers and honours credentials: omit; never include', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => ok(screen('home')))
    const factory = specScreenProvider({ basePath: '/sdui', merchantId: 'm', credentials: 'omit', traceHeaders: () => ({ traceparent: '00-abc-def-01' }), fetchImpl })
    await factory.data('home')
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', headers: { traceparent: '00-abc-def-01' } })
    expect(() => specScreenProvider({ basePath: '/sdui', merchantId: 'm', credentials: 'include' as 'omit' })).toThrow(TypeError)
  })

  it('fails closed: a version that is not one path segment, 404 → unknownScreen, 5xx → http, offline → network', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes('/ghost') ? new Response('{}', { status: 404 })
        : String(url).includes('/boom') ? new Response('{"errorCode":"SDUI-500"}', { status: 503 })
          : ok(screen('home')))
    const factory = specScreenProvider({ basePath: '/sdui', merchantId: 'm', fetchImpl })
    await expect(factory.data('home', { version: '../admin' })).rejects.toMatchObject({ kind: 'schema' })
    await expect(factory.data('home', { version: 'v1?x=1' })).rejects.toMatchObject({ kind: 'schema' })
    await expect(factory.data('ghost')).rejects.toMatchObject({ kind: 'unknownScreen' })
    await expect(factory.data('boom')).rejects.toMatchObject({ kind: 'http' })
    const offline = specScreenProvider({ basePath: '/sdui', merchantId: 'm', fetchImpl: async () => { throw new TypeError('offline') } })
    await expect(offline.data('home')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('specManifestLoader', () => {
  it('GET {basePath}/manifest/{mid}; 404 is an error, not a manifest', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => (String(url).includes('nobody') ? new Response('{}', { status: 404 }) : ok({ sequence: 3, screens: {} })))
    expect(JSON.parse(new TextDecoder().decode(await specManifestLoader({ basePath: '/sdui', merchantId: 'm', fetchImpl })()))).toEqual({ sequence: 3, screens: {} })
    expect(fetchImpl.mock.calls[0]![0]).toBe('/sdui/manifest/m')
    await expect(specManifestLoader({ basePath: '/sdui', merchantId: 'nobody', fetchImpl })()).rejects.toMatchObject({ kind: 'http' })
  })
})

describe('engine → provider version', () => {
  it('a screen named by the applied manifest is fetched at its versioned URL', async () => {
    const urls: string[] = []
    const fetchImpl = async (url: unknown) => {
      urls.push(String(url))
      return String(url).includes('/manifest/') ? ok({ sequence: 5, screens: { home: 'v2' } }) : ok(screen('home', 'v2 text'))
    }
    const engine = devEngine({
      screenFactory: specScreenProvider({ basePath: '/sdui', merchantId: 'm', fetchImpl }),
      manifestLoader: specManifestLoader({ basePath: '/sdui', merchantId: 'm', fetchImpl }),
      cache: new SduiCache({ store: new MemoryCacheStore() })
    })
    await engine.refreshManifest()
    const state = await engine.load(ScreenSource.key('home'))
    expect(state).toMatchObject({ kind: 'loaded' })
    expect(urls).toEqual(['/sdui/manifest/m', '/sdui/screens/m/home/v2'])
    // the same version again comes from the cache: no second download
    await engine.load(ScreenSource.key('home'))
    expect(urls).toHaveLength(2)
  })
})
