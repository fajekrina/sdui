// Regression tests for the 0.5.0 review findings (each named by its number).
import { describe, expect, it, vi } from 'vitest'
import {
  ActionDispatcher, MemoryCacheStore, ScreenFactory, ScreenSource, SduiCache, SduiError, utf8,
  type NetworkClient, type SduiEvent
} from '../src/core'
import { MESSAGES_ID } from '../src/i18n'
import { devEngine, flush } from './helpers'

const form = (button: object) => ({
  schemaVersion: '1.1',
  screen: { key: 's', root: { type: 'form', id: 'f', children: [{ type: 'textField', props: { name: 'amount', required: true } }, button] } }
})

describe('#1 one idempotency key per submission', () => {
  function setup(fail: () => boolean) {
    const keys: Array<string | undefined> = []
    const network: NetworkClient = {
      async perform(_r, _p, options) {
        keys.push(options?.idempotencyKey)
        if (fail()) throw SduiError.network(null)   // e.g. a timeout
        return utf8('{}')
      }
    }
    const ids = ['id-1', 'id-2', 'id-3']
    const engine = devEngine({ actionDispatcher: new ActionDispatcher({ network }), newId: () => ids.shift()! })
    const screen = engine.screen(ScreenSource.inline(form({ type: 'button', props: { title: 'Pay' }, action: { type: 'api', request: 'pay' } })))
    return { keys, screen }
  }
  const tap = async (screen: ReturnType<typeof setup>['screen']) => {
    const button = screen.render().nodes[0]!.children[1]!
    await screen.handle(button.on!.click!)
  }

  it('a retry after a failure (timeout) reuses the key; changed values start a new submission', async () => {
    let failing = true
    const { keys, screen } = setup(() => failing)
    await screen.load()
    screen.setFieldValue('f', 'amount', '100')
    await tap(screen)                                   // times out
    await tap(screen)                                   // same submission → same key
    failing = false
    screen.setFieldValue('f', 'amount', '200')          // the user changed the form
    await tap(screen)
    expect(keys).toEqual(['id-1:pay', 'id-1:pay', 'id-2:pay'])
  })

  it('after a success the next tap is a new submission', async () => {
    const { keys, screen } = setup(() => false)
    await screen.load()
    screen.setFieldValue('f', 'amount', '100')
    await tap(screen)
    await tap(screen)
    expect(keys).toEqual(['id-1:pay', 'id-2:pay'])
  })

  it('the default id source is crypto.randomUUID', () => {
    const id = devEngine().newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('#2 a newer layout never swaps under a user mid-interaction', () => {
  const page = (title: string, load: string[] = []) => JSON.stringify({
    schemaVersion: '1.1',
    screen: { key: 'home', load: load.map((request) => ({ request })), root: { type: 'form', id: 'f', children: [
      { type: 'text', props: { value: title } },
      { type: 'textField', props: { name: 'note' } }
    ] } }
  })

  async function restartWith(published: () => string, events: SduiEvent[] = [], network?: NetworkClient) {
    const store = new MemoryCacheStore()
    const factory = () => new ScreenFactory().register('home', published)
    await devEngine({ screenFactory: factory(), cache: new SduiCache({ store }) }).load(ScreenSource.key('home'))
    return devEngine({ screenFactory: factory(), cache: new SduiCache({ store }), onEvent: (e) => events.push(e), actionDispatcher: new ActionDispatcher({ network }) })
  }
  const title = (screen: { render(): { nodes: Array<{ children: Array<{ text?: string }> }> } }) => screen.render().nodes[0]!.children[0]!.text

  it('defers while the form is dirty, applies on request', async () => {
    let published = page('v1')
    const events: SduiEvent[] = []
    const engine = await restartWith(() => published, events)
    published = page('v2')
    const screen = engine.screen(ScreenSource.key('home'))
    await screen.load()                       // v1 from cache; revalidation running
    screen.setFieldValue('f', 'note', 'typing…')
    await engine.settled()
    expect(title(screen)).toBe('v1')          // not swapped mid-typing
    expect(screen.hasPendingUpdate).toBe(true)
    expect(events.some((e) => e.type === 'screen_update_deferred')).toBe(true)
    screen.applyPendingUpdate()
    expect(title(screen)).toBe('v2')
  })

  it('applies immediately when the user is idle, and re-runs screen.load when the list changed', async () => {
    let published = page('v1')
    const calls: string[] = []
    const network: NetworkClient = { async perform(r) { calls.push(r.rawValue); return utf8('{}') } }
    const engine = await restartWith(() => published, [], network)
    published = page('v2', ['getPromos'])
    const screen = engine.screen(ScreenSource.key('home'))
    await screen.load()
    await engine.settled(); await flush()
    expect(title(screen)).toBe('v2')
    expect(calls).toEqual(['getPromos'])
  })
})

describe('#3 the double-tap lock is held across a navigation', () => {
  it('a second tap right after navigate does not open the screen twice', async () => {
    vi.useFakeTimers()
    try {
      const navigate = vi.fn()
      const engine = devEngine({ actionDispatcher: new ActionDispatcher({ navigator: { navigate } }) })
      const screen = engine.screen(ScreenSource.inline({ schemaVersion: '1.1', screen: { key: 's', root: { type: 'button', props: { title: 'Next' }, action: { type: 'navigate', screen: 'next' } } } }))
      await screen.load()
      const key = screen.render().nodes[0]!.on!.click!
      await screen.handle(key)
      await screen.handle(key)                              // fast second tap
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(screen.render().nodes[0]!.attrs['aria-busy']).toBe('true')
      vi.advanceTimersByTime(1000)
      await screen.handle(key)                              // a deliberate later tap works
      expect(navigate).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#4 locales live outside the core entry', () => {
  it('MESSAGES_ID comes from ./i18n', () => {
    expect(MESSAGES_ID.required('NIK')).toBe('NIK wajib diisi')
  })
})
