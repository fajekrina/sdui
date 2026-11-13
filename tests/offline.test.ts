// HLD Target F2 (revalidation, envelope size, BFF options) and F3 (connectivity, persisted last-good, ./pwa).
import { describe, expect, it, vi } from 'vitest'
import { fetchNetworkClient, specManifestLoader, specScreenProvider } from '../src/browser'
import { connectivity, onServiceWorkerUpdate } from '../src/pwa'
import {
  ActionDispatcher, MemoryCacheStore, NamedRequest, ScreenSource, SduiCache,
  type ConnectivityPort, type SduiEvent
} from '../src/core'
import { devEngine, flush } from './helpers'

const screenJSON = (key: string, text = 'hi', extra: Record<string, unknown> = {}) =>
  ({ schemaVersion: '1.1', screen: { key, root: { type: 'text', props: { value: text } }, ...extra } })
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })

/// a backend: screens by key (+ optional ETag), a manifest, and a log of requests
function backend(screens: Record<string, { body: unknown; etag?: string }>, manifest?: { sequence: number; screens: Record<string, string> }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, headers })
    if (url.includes('/manifest/')) return manifest ? json(manifest) : new Response('{}', { status: 404 })
    const key = url.split('/screens/m/')[1]!.split('/')[0]!
    const entry = screens[key]
    if (!entry) return new Response('{}', { status: 404 })
    if (entry.etag && headers['If-None-Match'] === entry.etag) return new Response(null, { status: 304 })
    return json(entry.body, { headers: entry.etag ? { ETag: entry.etag } : {} })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

class Switch implements ConnectivityPort {
  private listeners = new Set<(online: boolean) => void>()
  constructor(public up = true) {}
  online() { return this.up }
  subscribe(l: (online: boolean) => void) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  set(up: boolean) { this.up = up; this.listeners.forEach((l) => l(up)) }
}

function engineFor(b: ReturnType<typeof backend>, store: MemoryCacheStore, extra: Parameters<typeof devEngine>[0] = {}) {
  const events: SduiEvent[] = []
  const delivery = { basePath: '/sdui', merchantId: 'm', fetchImpl: b.fetchImpl }
  const engine = devEngine({
    screenFactory: specScreenProvider(delivery),
    manifestLoader: specManifestLoader(delivery),
    cache: new SduiCache({ store }),
    onEvent: (e) => events.push(e),
    ...extra
  })
  return { engine, events }
}

describe('F2 · conditional revalidation', () => {
  it('stores the ETag; an unchanged unversioned screen revalidates with 304 and no re-render', async () => {
    const b = backend({ home: { body: screenJSON('home'), etag: '"abc"' } })
    const store = new MemoryCacheStore()
    await engineFor(b, store).engine.load(ScreenSource.key('home'))         // network, ETag kept

    const { engine, events } = engineFor(b, store)                          // a restart
    const onUpdate = vi.fn()
    expect(await engine.load(ScreenSource.key('home'), { onUpdate })).toMatchObject({ kind: 'loaded', origin: 'cache' })
    await engine.settled()
    expect(b.calls.at(-1)!.headers['If-None-Match']).toBe('"abc"')
    expect(events).toContainEqual(expect.objectContaining({ type: 'screen_not_modified', key: 'home' }))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('a changed screen (new ETag) reaches onUpdate and replaces the stored ETag', async () => {
    const screens = { home: { body: screenJSON('home', 'v1'), etag: '"1"' } }
    const b = backend(screens)
    const store = new MemoryCacheStore()
    await engineFor(b, store).engine.load(ScreenSource.key('home'))
    screens.home = { body: screenJSON('home', 'v2'), etag: '"2"' }
    const { engine } = engineFor(b, store)
    const onUpdate = vi.fn()
    await engine.load(ScreenSource.key('home'), { onUpdate })
    await engine.settled()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    await engineFor(b, store).engine.load(ScreenSource.key('home'))
    await flush()
    expect(b.calls.at(-1)!.headers['If-None-Match']).toBe('"2"')
  })

  it('a provider may not answer notModified unless asked with an etag', async () => {
    const { engine } = engineFor(backend({}), new MemoryCacheStore())
    engine.screenFactory.register('odd', () => ({ notModified: true }))
    expect(await engine.load(ScreenSource.key('odd'))).toMatchObject({ kind: 'failed', error: { kind: 'decode' } })
  })
})

describe('F2 · maxEnvelopeBytes', () => {
  it('rejects oversized bytes before decode, with an event', async () => {
    const b = backend({ big: { body: screenJSON('big', 'x'.repeat(2000)) } })
    const { engine, events } = engineFor(b, new MemoryCacheStore(), { maxEnvelopeBytes: 1000 })
    expect(await engine.load(ScreenSource.key('big'))).toMatchObject({ kind: 'failed', error: { kind: 'bounds' } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'envelope_too_large' }))
    expect(engineFor(b, new MemoryCacheStore()).engine.maxEnvelopeBytes).toBe(1_048_576)
  })
})

describe('F2 · fetchNetworkClient for a BFF', () => {
  it('credentials same-origin + CSRF from getHeaders + traceparent; never include', async () => {
    const fetchImpl = vi.fn(async (_u: unknown, _i?: RequestInit) => json({ ok: true }))
    const client = fetchNetworkClient({
      baseUrl: '/bff', endpoints: { pay: { method: 'POST', path: '/pay' } }, credentials: 'same-origin',
      getHeaders: () => ({ 'X-CSRF-Token': 't0k' }), traceHeaders: () => ({ traceparent: '00-a-b-01' }), fetchImpl
    })
    await client.perform(new NamedRequest('pay'), { amount: 1 })
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', headers: { 'X-CSRF-Token': 't0k', traceparent: '00-a-b-01' } })
    const bearer = fetchNetworkClient({ baseUrl: '/api', endpoints: { pay: { method: 'POST', path: '/pay' } }, fetchImpl })
    await bearer.perform(new NamedRequest('pay'), {})
    expect(fetchImpl.mock.calls[1]![1]!.credentials).toBe('omit')
    expect(() => fetchNetworkClient({ baseUrl: '/', endpoints: {}, credentials: 'include' as 'omit' })).toThrow(TypeError)
  })
})

describe('F3 · offline after a restart', () => {
  it('serves the cached versioned layout without touching the network (origin offline)', async () => {
    const b = backend({ home: { body: screenJSON('home') } }, { sequence: 2, screens: { home: 'v2' } })
    const store = new MemoryCacheStore()
    const first = engineFor(b, store).engine
    await first.refreshManifest()
    await first.load(ScreenSource.key('home'))
    const before = b.calls.length

    const { engine } = engineFor(b, store, { connectivity: new Switch(false) })
    await engine.refreshManifest()                                            // offline: skipped
    expect(await engine.load(ScreenSource.key('home'))).toMatchObject({ kind: 'loaded', origin: 'offline' })
    expect(b.calls.length).toBe(before)
  })

  it('falls back to the persisted last-good pointer when the manifest names a version not yet downloaded', async () => {
    const manifest = { sequence: 2, screens: { home: 'v2' } }
    const b = backend({ home: { body: screenJSON('home', 'v2 text') } }, manifest)
    const store = new MemoryCacheStore()
    const first = engineFor(b, store).engine
    await first.refreshManifest()
    await first.load(ScreenSource.key('home'))
    manifest.sequence = 3
    manifest.screens.home = 'v3'
    await engineFor(b, store).engine.refreshManifest()                       // v3 known, never fetched

    const { engine } = engineFor(b, store, { connectivity: new Switch(false) })
    const state = await engine.load(ScreenSource.key('home'))
    expect(state).toMatchObject({ kind: 'loaded', origin: 'offline' })
    expect(JSON.stringify(state.kind === 'loaded' && state.screen.toJSON())).toContain('v2 text')
  })

  it('a tampered last-good is not trusted; nothing cached → network error', async () => {
    const store = new MemoryCacheStore()
    const b = backend({ home: { body: screenJSON('home') } })
    const { engine } = engineFor(b, store, { connectivity: new Switch(false) })
    expect(await engine.load(ScreenSource.key('home'))).toMatchObject({ kind: 'failed', error: { kind: 'network' } })
    await store.store(new TextEncoder().encode('{"not":"a screen"}'), 'home@v9')
    await store.store(new TextEncoder().encode('v9'), 'sdui:lastgood:home')
    expect(await engine.load(ScreenSource.key('home'))).toMatchObject({ kind: 'failed', error: { kind: 'network' } })
    expect(b.calls).toHaveLength(0)
  })
})

describe('F3 · actions and screen.load offline; back online', () => {
  it('offline: screen.load sends nothing and reads error; api fails fast into onError; online again reloads data', async () => {
    const net = vi.fn(async () => new TextEncoder().encode('{"balance":5}'))
    const sw = new Switch(false)
    const store = new MemoryCacheStore()
    const screen = screenJSON('home', 'hi', { load: [{ request: 'getBalance' }] })
    screen.screen.root = {
      type: 'button', props: { title: 'Pay' },
      action: { type: 'api', request: 'pay', onError: { type: 'toast', message: 'offline', level: 'error' } }
    } as never
    const b = backend({ home: { body: screen } })
    await engineFor(b, store).engine.load(ScreenSource.key('home'))       // cached while online

    const { engine, events } = engineFor(b, store, { connectivity: sw, actionDispatcher: new ActionDispatcher({ network: { perform: net } }) })
    const controller = engine.screen(ScreenSource.key('home'))
    expect(await controller.load()).toMatchObject({ kind: 'loaded', origin: 'offline' })
    await flush()
    expect(controller.data.get('$load')).toEqual({ getBalance: 'error' })
    expect(controller.data.get('$offline')).toBe(true)

    const tree = controller.render()
    const key = JSON.stringify(tree.nodes).match(/"click":"([^"]+)"/)?.[1]
    expect(key).toBeDefined()
    await controller.handle(key!)
    expect(net).not.toHaveBeenCalled()
    expect(controller.ui.getState().toasts.map((t) => t.message)).toEqual(['offline'])

    sw.set(true)                                                             // back online
    await vi.waitFor(() => expect(net).toHaveBeenCalled())
    expect(events).toContainEqual({ type: 'connectivity_changed', online: true })
    await vi.waitFor(() => expect(controller.loadState).toMatchObject({ kind: 'loaded' }))
    controller.destroy()
  })
})

describe('./pwa', () => {
  function fakeWindow(onLine = true) {
    const handlers: Record<string, Array<() => void>> = {}
    return {
      navigator: { onLine },
      addEventListener: (t: string, h: () => void) => { (handlers[t] ??= []).push(h) },
      removeEventListener: (t: string, h: () => void) => { handlers[t] = (handlers[t] ?? []).filter((x) => x !== h) },
      fire(t: string) { (handlers[t] ?? []).forEach((h) => h()) },
      handlers
    }
  }

  it('connectivity(): online/offline events; a failing probe means offline; unsubscribe detaches', async () => {
    const win = fakeWindow(true)
    let probeOk = false
    const port = connectivity({ target: win as never, probeUrl: '/ping', fetchImpl: (async () => new Response(null, { status: probeOk ? 200 : 503 })) as never })
    const seen: boolean[] = []
    const stop = port.subscribe!((o) => seen.push(o))
    win.navigator.onLine = false
    win.fire('offline')
    expect(seen).toEqual([false])
    win.navigator.onLine = true
    win.fire('online')                                                       // probe says 503
    await vi.waitFor(() => expect(port.online()).toBe(false))
    probeOk = true
    win.fire('online')
    await vi.waitFor(() => expect(seen).toEqual([false, true]))
    stop()
    expect(win.handlers.online).toHaveLength(0)
  })

  it('onServiceWorkerUpdate(): offers a waiting worker; apply respects canApply, then reloads on controllerchange', async () => {
    const posted: unknown[] = []
    const waiting = { postMessage: (m: unknown) => posted.push(m) }
    const listeners: Record<string, () => void> = {}
    const container = {
      controller: {},
      addEventListener: (t: string, h: () => void) => { listeners[t] = h },
      removeEventListener: () => undefined,
      getRegistration: async () => ({ waiting, addEventListener: () => undefined })
    }
    let allowed = false
    const reload = vi.fn()
    let apply: (() => void) | undefined
    onServiceWorkerUpdate({ container: container as never, reload, canApply: () => allowed, onAvailable: (a) => { apply = a } })
    await vi.waitFor(() => expect(apply).toBeDefined())
    apply!()
    expect(posted).toEqual([])                                               // a form is dirty: wait
    allowed = true
    apply!()
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }])
    listeners.controllerchange!()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
