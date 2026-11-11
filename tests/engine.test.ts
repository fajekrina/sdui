import { describe, expect, it, vi } from 'vitest'
import {
  ActionDispatcher, ComponentFactory, MemoryCacheStore, NamedRequest, PayloadSecurity, ScreenFactory, ScreenSource,
  SduiCache, SduiEngine, SduiError, cacheKey, createEngine, errorKindOf, utf8, type NetworkClient, type RenderNode,
  type SduiEvent, type SduiProps
} from '../src/core'
import { fixture, flush, Counter } from './helpers'

const text = (nodes: RenderNode[]): string => nodes.map((n) => (n.text ?? '') + text(n.children)).join('')
const find = (nodes: RenderNode[], pred: (n: RenderNode) => boolean): RenderNode | undefined => {
  for (const n of nodes) {
    if (pred(n)) return n
    const hit = find(n.children, pred)
    if (hit) return hit
  }
  return undefined
}

const payload = (root: object, extra: object = {}) => JSON.stringify({ schemaVersion: '1.1', screen: { key: 's', root, ...extra } })

/// A network client answering named requests from a table.
function fakeNetwork(table: Record<string, unknown | Error>, calls: Array<[string, SduiProps]> = []): NetworkClient {
  return {
    async perform(request: NamedRequest, params: SduiProps) {
      calls.push([request.rawValue, params])
      const answer = table[request.rawValue]
      if (answer === undefined) throw SduiError.unknownRequest(request.rawValue)
      if (answer instanceof Error) throw answer
      return utf8(JSON.stringify(answer))
    }
  }
}

describe('SduiEngine.load', () => {
  const engine = (factory = new ScreenFactory()) => createEngine({ screenFactory: factory })

  it('loads inline, key, and fails closed for unknown / named-without-resolver / garbage / invalid', async () => {
    expect((await engine().load(ScreenSource.inline(payload({ type: 'vstack' })))).kind).toBe('loaded')
    const factory = new ScreenFactory().register('home', payload({ type: 'text' }))
    const keyed = await engine(factory).load(ScreenSource.key('home'))
    expect(keyed.kind === 'loaded' && keyed.screen.root.type).toBe('text')
    const ghost = await engine().load(ScreenSource.key('ghost'))
    expect(ghost.kind === 'failed' && ghost.error.equals(SduiError.unknownScreen('ghost'))).toBe(true)
    expect((await engine().load(ScreenSource.named('remote'))).kind).toBe('failed')
    expect((await engine().load(ScreenSource.inline('not json'))).kind).toBe('failed')
    const invalid = await engine().load(ScreenSource.inline(fixture('invalid/navigate_missing_screen.json')))
    expect(invalid.kind === 'failed' && invalid.error.kind).toBe('schema')
  })

  it('a fallback provider resolves every key (the backend)', async () => {
    const factory = new ScreenFactory().registerFallback((key) => payload({ type: 'text', props: { value: key } }))
    const state = await engine(factory).load(ScreenSource.key('anything'))
    expect(state.kind === 'loaded' && state.screen.root.string('value')).toBe('anything')
  })

  it('maps http errors to error-view kinds', () => {
    expect(errorKindOf(SduiError.http(404, 'x', 'SDUI-002'))).toBe('notFound')
    expect(errorKindOf(SduiError.http(403))).toBe('forbidden')
    expect(errorKindOf(SduiError.http(409))).toBe('rejected')
    expect(errorKindOf(SduiError.http(503))).toBe('unavailable')
    expect(errorKindOf(SduiError.network(null))).toBe('offline')
    expect(errorKindOf(SduiError.signatureInvalid())).toBe('invalid')
  })

  it('emits screen_loaded and validation_failed', async () => {
    const events: SduiEvent[] = []
    const e = createEngine({ onEvent: (ev) => events.push(ev) })
    await e.load(ScreenSource.inline(payload({ type: 'text' })))
    await e.load(ScreenSource.inline('{}'))
    expect(events.map((ev) => ev.type)).toEqual(['screen_loaded', 'validation_failed'])
  })
})

describe('ScreenController', () => {
  it('renders tokens from seed, re-renders on data change', async () => {
    const screen = createEngine().screen(ScreenSource.inline(payload({ type: 'text', props: { value: 'Hi {{name}}' } })), { seed: { name: 'Ada' } })
    await screen.load()
    expect(text(screen.render().nodes)).toBe('Hi Ada')
    screen.data.merge({ name: 'Grace' })
    expect(text(screen.render().nodes)).toBe('Hi Grace')
  })

  it('shows a loading view, then the fail-closed error view', async () => {
    const screen = createEngine().screen(ScreenSource.key('ghost'))
    expect(find(screen.render().nodes, (n) => n.attrs.role === 'progressbar')).toBeDefined()
    await screen.load()
    const error = find(screen.render().nodes, (n) => n.attrs.role === 'alert')!
    expect(error.attrs['data-sdui-error']).toBe('unknownScreen')
    expect(text([error])).toContain('Not Found')
  })

  it('screen.load runs requests in parallel, shows skeletons, then merges results', async () => {
    const calls: Array<[string, SduiProps]> = []
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const network: NetworkClient = {
      async perform(request, params) {
        calls.push([request.rawValue, params])
        await gate
        if (request.rawValue === 'getPromos') throw SduiError.http(500)
        return utf8(JSON.stringify({ amount: 1250 }))
      }
    }
    const engine = createEngine({ actionDispatcher: new ActionDispatcher({ network }) })
    const screen = engine.screen(ScreenSource.inline(fixture('valid/home_load.json')), { seed: { user: { name: 'Ada', segment: 'gold' } } })
    await screen.load()
    expect(calls.map((c) => c[0]).sort()).toEqual(['getBalance', 'getPromos'])   // both started before either finished
    expect(calls.find((c) => c[0] === 'getPromos')![1]).toEqual({ segment: 'gold' })
    expect(find(screen.render().nodes, (n) => n.attrs['aria-busy'] === 'true')).toBeDefined()   // skeleton for Rp{{getBalance.amount}}
    release()
    await flush(); await flush()
    expect(text(screen.render().nodes)).toContain('Rp1250')
    expect(screen.data.value('$load.getPromos')).toBe('error')
    expect(screen.data.value('$load.getBalance')).toBe('ok')
  })

  it('forms: named patterns block the action; valid input dispatches with {{form.*}} params', async () => {
    const calls: Array<[string, SduiProps]> = []
    const network = fakeNetwork({ createTransfer: { id: 'T1' } }, calls)
    const host = { native: vi.fn(async () => ({ confirmed: true })) }
    const navigator = { dismiss: vi.fn() }
    const engine = createEngine({ actionDispatcher: new ActionDispatcher({ network, host, navigator }) })
    const screen = engine.screen(ScreenSource.inline(fixture('valid/transfer_form.json')))
    await screen.load()
    const send = () => find(screen.render().nodes, (n) => n.element === 'button')!.on!.click!

    await screen.handle(send())
    expect(calls).toHaveLength(0)
    let errors = screen.ui.getState().forms.transfer!.errors
    expect(Object.keys(errors).sort()).toEqual(['account', 'amount', 'pin'])

    screen.setFieldValue('transfer', 'account', '12345')          // too short
    screen.setFieldValue('transfer', 'amount', '-5')              // not a positive amount
    screen.setFieldValue('transfer', 'pin', '123456')
    await screen.handle(send())
    errors = screen.ui.getState().forms.transfer!.errors
    expect(Object.keys(errors).sort()).toEqual(['account', 'amount'])

    screen.setFieldValue('transfer', 'account', '1234567890')
    screen.setFieldValue('transfer', 'amount', '150000')
    screen.setFieldValue('transfer', 'purpose', 'bills')
    await screen.handle(send())
    expect(host.native).toHaveBeenCalledWith('biometricConfirm', { reason: 'Confirm transfer of 150000' })
    expect(calls).toEqual([['createTransfer', { account: '1234567890', amount: '150000', purpose: 'bills' }]])
    expect(screen.ui.getState().toasts.map((t) => [t.message, t.level])).toEqual([['Sent 150000', 'success']])
    expect(navigator.dismiss).toHaveBeenCalled()
    expect(screen.data.value('createTransfer.id')).toBe('T1')     // results reach the screen data
    expect(screen.data.value('form')).toBeUndefined()             // field values never leak out of the form scope
    expect(find(screen.render().overlays, (n) => n.attrs['data-sdui-toast'] === 'success')).toBeDefined()
  })

  it('native: no host → onError', async () => {
    const engine = createEngine()
    const screen = engine.screen(ScreenSource.inline(payload({ type: 'button', props: { title: 'x' }, action: { type: 'native', command: 'share', onError: { type: 'toast', message: 'Not supported', level: 'warning' } } })))
    await screen.load()
    await screen.handle(screen.render().nodes[0]!.on!.click!)
    expect(screen.ui.getState().toasts[0]!.message).toBe('Not supported')
  })

  it('navigate passes presentation; openURL passes a NAME; refresh reloads', async () => {
    const navigate = vi.fn()
    const openLink = vi.fn()
    const loads = new Counter()
    const factory = new ScreenFactory().register('home', () => { loads.bump(); return payload({ type: 'vstack', children: [
      { type: 'button', props: { title: 'a' }, action: { type: 'navigate', screen: 'next', presentation: 'sheet', params: { id: 7 } } },
      { type: 'button', props: { title: 'b' }, action: { type: 'openURL', link: 'helpCenter' } },
      { type: 'button', props: { title: 'c' }, action: { type: 'refresh' } }
    ] }) })
    const engine = createEngine({ screenFactory: factory, actionDispatcher: new ActionDispatcher({ navigator: { navigate, openLink } }) })
    const screen = engine.screen(ScreenSource.key('home'))
    await screen.load()
    const [a, b, c] = screen.render().nodes[0]!.children
    await screen.handle(a!.on!.click!)
    await screen.handle(b!.on!.click!)
    await screen.handle(c!.on!.click!)
    await flush()
    expect(navigate).toHaveBeenCalledWith('next', { id: 7 }, { presentation: 'sheet' })
    expect(openLink).toHaveBeenCalledWith('helpCenter')
    expect(loads.count).toBe(2)
  })

  it('variants follow the viewport width', async () => {
    let width = 375
    const listeners = new Set<() => void>()
    const engine = createEngine({ viewport: { width: () => width, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) } } })
    const screen = engine.screen(ScreenSource.inline(fixture('valid/home_load.json')), { seed: { user: { name: 'Ada' } } })
    await screen.load()
    expect(screen.render().nodes[0]!.type).toBe('scroll')
    width = 1024
    listeners.forEach((l) => l())
    expect(screen.render().nodes[0]!.type).toBe('hstack')
  })

  it('unknown types: Null Object (marker only in debug) + unknown_component event', async () => {
    const events: SduiEvent[] = []
    const json = payload({ type: 'vstack', children: [{ type: 'lottie' }, { type: 'text', props: { value: 'after' } }] })
    const quiet = createEngine({ onEvent: (e) => events.push(e) }).screen(ScreenSource.inline(json))
    await quiet.load()
    expect(quiet.render().nodes[0]!.children.map((n) => n.type)).toEqual(['text'])
    expect(events.some((e) => e.type === 'unknown_component')).toBe(true)
    const debug = createEngine({ debug: true }).screen(ScreenSource.inline(json))
    await debug.load()
    expect(text(debug.render().nodes)).toContain('unknown: lottie')
  })

  it('slots: a toolkit type renders as a slot node when the adapter claims it', async () => {
    const screen = createEngine().screen(ScreenSource.inline(payload({ type: 'chart', props: { series: [1, 2] } })))
    await screen.load()
    expect(screen.render({ slots: ['chart'] }).nodes[0]!.slot).toEqual({ type: 'chart', props: { series: [1, 2] }, data: {} })
  })
})

describe('cache tiers (unsigned)', () => {
  it('memory → persistent → network, keyed by screen@version', async () => {
    const fetches = new Counter()
    const store = new MemoryCacheStore()
    const factory = new ScreenFactory().register('home', () => { fetches.bump(); return payload({ type: 'text' }) })
    const engine = new SduiEngine({ screenFactory: factory, cache: new SduiCache({ store }), componentFactory: ComponentFactory.withBuiltins(), security: PayloadSecurity.insecureDevelopment })
    const first = await engine.load(ScreenSource.key('home'))
    const second = await engine.load(ScreenSource.key('home'))
    engine.coordinator!.purgeRenderCache()
    const third = await engine.load(ScreenSource.key('home'))
    expect([first, second, third].map((s) => s.kind === 'loaded' && s.origin)).toEqual(['network', 'memory', 'cache'])
    expect(fetches.count).toBe(1)
    expect(await store.data(cacheKey('home', 'unversioned'))).toBeDefined()
  })
})
