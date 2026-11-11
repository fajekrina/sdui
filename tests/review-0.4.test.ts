// Regression tests for the 0.4.0 review findings (each named by its number).
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import {
  ActionDispatcher, Manifest, MemoryCacheStore, NamedRequest, PayloadSecurity, ScreenFactory, ScreenSource,
  SduiCache, createEngine, relativeAssetURL, sortedJSONStringify, utf8, type NetworkClient, type RenderNode, type SduiEvent
} from '../src/core'
import { fetchNetworkClient, webCryptoEd25519 } from '../src/browser'
import { MESSAGES_ID } from '../src/i18n'
import { Bridge, nativeBridgePorts, type BridgeTransport } from '../src/bridge'
import { devEngine, envelopeJSON, flush, signingKey } from './helpers'

const page = (value: string) => JSON.stringify({ schemaVersion: '1.1', screen: { key: 'home', root: { type: 'text', props: { value } } } })
const textOf = (n: RenderNode): string => (n.text ?? '') + n.children.map(textOf).join('')

describe('#1 a cached layout is revalidated when there is no manifest', () => {
  it('load v1, backend publishes v2, restart → shows v1 at once, then v2', async () => {
    const store = new MemoryCacheStore()
    let published = 'v1'
    const factory = () => new ScreenFactory().register('home', () => page(published))
    const first = devEngine({ screenFactory: factory(), cache: new SduiCache({ store }) })
    await first.load(ScreenSource.key('home'))

    published = 'v2'                                                     // backend publishes
    const restarted = devEngine({ screenFactory: factory(), cache: new SduiCache({ store }) })   // app restart, same disk
    const screen = restarted.screen(ScreenSource.key('home'))
    await screen.load()
    expect(screen.loadState.kind === 'loaded' && screen.loadState.origin).toBe('cache')
    expect(textOf(screen.render().nodes[0]!)).toBe('v1')                // instant, from cache
    await restarted.settled()
    expect(textOf(screen.render().nodes[0]!)).toBe('v2')                // replaced in place
    const again = await restarted.load(ScreenSource.key('home'))
    expect(again.kind === 'loaded' && again.screen.root.string('value')).toBe('v2')
  })

  it('a failed revalidation keeps the cached screen', async () => {
    const store = new MemoryCacheStore()
    let online = true
    const factory = new ScreenFactory().register('home', () => { if (!online) throw new Error('offline'); return page('v1') })
    const events: SduiEvent[] = []
    await devEngine({ screenFactory: factory, cache: new SduiCache({ store }) }).load(ScreenSource.key('home'))
    online = false
    const engine = devEngine({ screenFactory: factory, cache: new SduiCache({ store }), onEvent: (e) => events.push(e) })
    const state = await engine.load(ScreenSource.key('home'))
    await engine.settled()
    expect(state.kind).toBe('loaded')
    expect(events.find((e) => e.type === 'screen_revalidated')).toMatchObject({ changed: false })
  })
})

describe('#2 the anti-rollback floor survives a restart', () => {
  it('apply sequence 10, restart, an older validly-signed manifest (3) is rejected', async () => {
    const key = await signingKey()
    const verifier = await webCryptoEd25519(key.publicKey)
    const store = new MemoryCacheStore()
    const manifest = async (seq: number) => {
      const body = utf8(sortedJSONStringify(new Manifest(seq, { home: `v${seq}` })))
      return envelopeJSON(body, await key.sign(body))
    }
    const make = (seq: number, events: SduiEvent[] = []) => createEngine({
      security: PayloadSecurity.signed(verifier), cache: new SduiCache({ store }), manifestLoader: () => manifest(seq), onEvent: (e) => events.push(e)
    })
    await make(10).refreshManifest()
    const events: SduiEvent[] = []
    const restarted = make(3, events)
    await restarted.refreshManifest()
    expect(restarted.coordinator!.version('home')).toBe('v10')
    expect(events).toContainEqual({ type: 'rollback_rejected', sequence: 3 })
  })
})

describe('#3 double tap', () => {
  it('a second tap while the action runs is ignored; the button is disabled + aria-busy', async () => {
    let release!: () => void
    const calls: Array<string | undefined> = []
    const network: NetworkClient = {
      async perform(_r: NamedRequest, _p, options) {
        calls.push(options?.idempotencyKey)
        await new Promise<void>((r) => { release = r })
        return utf8('{}')
      }
    }
    const engine = devEngine({ actionDispatcher: new ActionDispatcher({ network }) })
    const screen = engine.screen(ScreenSource.inline({ schemaVersion: '1.1', screen: { key: 's', root: { type: 'button', props: { title: 'Pay' }, action: { type: 'api', request: 'pay' } } } }))
    await screen.load()
    const key = screen.render().nodes[0]!.on!.click!
    const first = screen.handle(key)
    await flush()
    void screen.handle(key)                                 // double tap
    await flush()
    const busy = screen.render().nodes[0]!
    expect(busy.attrs).toMatchObject({ disabled: true, 'aria-busy': 'true' })
    expect(calls).toHaveLength(1)
    release()
    await first
    expect(screen.render().nodes[0]!.attrs.disabled).toBeUndefined()
    expect(calls[0]).toMatch(/:pay$/)                       // idempotency key per tap + request
  })

  it('fetchNetworkClient sends Idempotency-Key on writes only', async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response('{}'))
    const client = fetchNetworkClient({ baseUrl: 'x', endpoints: { pay: { method: 'POST', path: '/pay' }, get: { method: 'GET', path: '/g' } }, fetchImpl })
    await client.perform(new NamedRequest('pay'), {}, { idempotencyKey: 'k1:pay' })
    await client.perform(new NamedRequest('get'), {}, { idempotencyKey: 'k1:get' })
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>)['Idempotency-Key']).toBe('k1:pay')
    expect((fetchImpl.mock.calls[1]![1]!.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined()
  })
})

describe('#4 no security policy', () => {
  it('release build without PayloadSecurity rejects every payload (fail-closed) and says so', async () => {
    const error = vi.fn()
    const engine = createEngine({ logger: { warn: () => {}, error } })
    const state = await engine.load(ScreenSource.inline(page('x')))
    expect(state.kind === 'failed' && state.error.kind).toBe('signatureInvalid')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no PayloadSecurity'))
  })

  it('debug build accepts unsigned payloads, loudly', async () => {
    const warn = vi.fn()
    const engine = createEngine({ debug: true, logger: { warn, error: () => {} } })
    expect((await engine.load(ScreenSource.inline(page('x')))).kind).toBe('loaded')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('UNSIGNED'))
  })
})

describe('#5 path parameters', () => {
  const client = (fetchImpl = vi.fn(async () => new Response('{}'))) =>
    ({ fetchImpl, client: fetchNetworkClient({ baseUrl: 'https://api.example.com', endpoints: { acc: { method: 'GET', path: '/accounts/{id}/balance' } }, fetchImpl }) })

  it.each(['..', '.', '', '  ', null])('rejects %j without sending', async (id) => {
    const { client: c, fetchImpl } = client()
    await expect(c.perform(new NamedRequest('acc'), id === null ? {} : { id })).rejects.toMatchObject({ kind: 'schema' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('still encodes normal values', async () => {
    const { client: c, fetchImpl } = client()
    await c.perform(new NamedRequest('acc'), { id: 'a/b..c' })
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://api.example.com/accounts/a%2Fb..c/balance')
  })
})

describe('#6 image URLs', () => {
  it('the default asset mapping refuses absolute and parent-relative URLs', () => {
    for (const bad of ['https://evil.example.com/x.png', '//evil.example.com/x.png', 'data:image/png;base64,AAA', 'javascript:alert(1)', '../secret.png', 'a/../../b.png']) {
      expect(relativeAssetURL(bad)).toBe('')
    }
    expect(relativeAssetURL('img/hero.png')).toBe('img/hero.png')
  })

  it('an image with a refused name renders without a src', async () => {
    const screen = devEngine().screen(ScreenSource.inline({ schemaVersion: '1.1', screen: { key: 's', root: { type: 'image', props: { name: 'https://evil.example.com/x.png' } } } }))
    await screen.load()
    expect(screen.render().nodes[0]!.attrs.src).toBeUndefined()
  })
})

describe('#7 secure ≠ numeric keyboard', () => {
  it('an alphanumeric secure field keeps the text keyboard', async () => {
    const screen = devEngine().screen(ScreenSource.inline({ schemaVersion: '1.1', screen: { key: 's', root: { type: 'form', children: [
      { type: 'textField', props: { name: 'password', secure: true } },
      { type: 'textField', props: { name: 'pin', secure: true, keyboard: 'number' } }
    ] } } }))
    await screen.load()
    const [pw, pin] = screen.render().nodes[0]!.children.map((f) => f.children[1]!.attrs)
    expect(pw).toMatchObject({ type: 'password' })
    expect(pw!.inputmode).toBeUndefined()
    expect(pin).toMatchObject({ type: 'password', inputmode: 'decimal' })
  })
})

describe('#8 token requests are deduplicated', () => {
  it('parallel getHeaders share one auth.token call', async () => {
    let calls = 0
    let deliver: (m: string) => void = () => {}
    const transport: BridgeTransport = {
      post(raw) {
        const msg = JSON.parse(raw)
        if (msg.method === 'auth.token') calls++
        setTimeout(() => deliver(JSON.stringify({ v: 1, id: msg.id, ok: true, result: { accessToken: 't' } })), 5)
      },
      listen(on) { deliver = on }
    }
    const ports = nativeBridgePorts({ transport })
    const all = await Promise.all([ports.getHeaders({ refresh: false }), ports.getHeaders({ refresh: false }), ports.getHeaders({ refresh: false })])
    expect(calls).toBe(1)
    expect(all.every((h) => h.Authorization === 'Bearer t')).toBe(true)
  })
})

describe('#9 forged host messages', () => {
  it('unknown events and ids that were never requested are ignored', async () => {
    let deliver: (m: string) => void = () => {}
    const bridge = new Bridge({ post() {}, listen(on) { deliver = on } }, 50)
    const seen = vi.fn()
    bridge.on('host.back', seen)
    bridge.on('host.injected', seen)
    deliver(JSON.stringify({ v: 1, event: 'host.injected' }))
    deliver(JSON.stringify({ v: 1, id: 'r-999', ok: true, result: 'forged' }))
    deliver(JSON.stringify({ v: 1, id: '__proto__', ok: true }))
    deliver(JSON.stringify({ v: 1, event: 'host.back' }))
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('the iOS receiver cannot be replaced by page scripts', async () => {
    const win = { webkit: { messageHandlers: { sdui: { postMessage() {} } } } } as unknown as Window & { sduiBridge: unknown }
    const { platformTransport } = await import('../src/bridge')
    platformTransport(win as unknown as Window)!.listen(() => {})
    const original = win.sduiBridge
    expect(() => { (win as { sduiBridge: unknown }).sduiBridge = { receive() {} } }).toThrow()
    expect(win.sduiBridge).toBe(original)
    expect(Object.isFrozen(original)).toBe(true)
  })
})

describe('#10 localized validation messages', () => {
  it('the host supplies the messages', async () => {
    const engine = devEngine({ messages: MESSAGES_ID })
    const screen = engine.screen(ScreenSource.inline({ schemaVersion: '1.1', screen: { key: 's', root: { type: 'form', id: 'f', children: [
      { type: 'textField', props: { name: 'nik', label: 'NIK', required: true } },
      { type: 'button', props: { title: 'Kirim' }, action: { type: 'dismiss' } }
    ] } } }))
    await screen.load()
    await screen.handle(screen.render().nodes[0]!.children[1]!.on!.click!)
    expect(screen.ui.getState().forms.f!.errors.nik).toBe('NIK wajib diisi')
  })
})
