import { describe, expect, it } from 'vitest'
import {
  ActionSpec, ActionType, DataContext, SchemaValidator, SduiBounds, SduiError, SduiNode, SduiPayload, SduiValue, ScreenSpec,
  TokenResolver, parseJSON, resolveValue, sortedJSONStringify, tokenKeys, type SduiProps
} from '../src/core'
import { fixture } from './helpers'

describe('SduiValue', () => {
  it('decodes each JSON kind and rejects values outside the closed space', () => {
    const dict = SduiValue.decodeObject(parseJSON('{ "s": "hi", "n": 12, "b": true, "z": null, "a": [1, "two"], "o": { "k": "v" } }'))
    expect(dict).toEqual({ s: 'hi', n: 12, b: true, z: null, a: [1, 'two'], o: { k: 'v' } })
    expect(() => SduiValue.decode(undefined)).toThrow()
    expect(() => SduiValue.decode(Number.NaN)).toThrow()
  })

  it('typed accessors and displayString', () => {
    expect(SduiValue.intValue(3.9)).toBe(3)
    expect(SduiValue.displayString(12)).toBe('12')
    expect(SduiValue.displayString(1.5)).toBe('1.5')
    expect(SduiValue.displayString(false)).toBe('false')
    expect(SduiValue.displayString(null)).toBe('')
  })
})

describe('SduiNode', () => {
  it('decodes type, props, children, action and never fabricates an id', () => {
    const node = SduiNode.decode(parseJSON('{ "type": "vstack", "props": { "spacing": 12 }, "children": [ { "type": "text", "props": { "value": "hi" } } ], "action": { "type": "refresh" } }'))
    expect(node.int('spacing')).toBe(12)
    expect(node.children[0]!.string('value')).toBe('hi')
    expect(node.action?.type).toBe('refresh')
    expect(node.id).toBeUndefined()
  })

  it('missing type is rejected; defaulting accessors never throw', () => {
    expect(() => SduiNode.decode({ props: {} })).toThrow(SduiError)
    const node = new SduiNode({ type: 'text' })
    expect([node.string('x'), node.int('x'), node.bool('x'), node.array('x')]).toEqual(['', 0, false, []])
  })

  it('round-trips through JSON', () => {
    const node = new SduiNode({ type: 'button', props: { title: 'Go' }, action: new ActionSpec({ type: 'navigate', screen: 'next', presentation: 'sheet' }) })
    expect(SduiNode.decode(parseJSON(sortedJSONStringify(node))).equals(node)).toBe(true)
  })
})

describe('ActionSpec', () => {
  it('has the closed v1.1 vocabulary', () => {
    expect(ActionType.allCases).toEqual(['navigate', 'api', 'dismiss', 'refresh', 'openURL', 'toast', 'native'])
  })

  it('decodes v1.1 fields and rejects unknown enums', () => {
    const a = ActionSpec.decode({ type: 'toast', message: 'Hi {{n}}', level: 'success', onSuccess: { type: 'native', command: 'share' } })
    expect(a.level).toBe('success')
    expect(a.onSuccess?.command).toBe('share')
    expect(() => ActionSpec.decode({ type: 'eval' })).toThrow()
    expect(() => ActionSpec.decode({ type: 'navigate', screen: 's', presentation: 'popover' })).toThrow()
    expect(() => ActionSpec.decode({ type: 'toast', message: 'x', level: 'fatal' })).toThrow()
  })
})

describe('SduiPayload v1.1', () => {
  it('decodes load and variants and round-trips', () => {
    const payload = SduiPayload.fromJSON(fixture('valid/home_load.json'))
    expect(payload.screen.load.map((l) => l.request)).toEqual(['getBalance', 'getPromos'])
    expect(payload.screen.variants.wide?.type).toBe('hstack')
    expect(SduiPayload.fromJSON(sortedJSONStringify(payload)).equals(payload)).toBe(true)
  })

  it('a murti v1 payload stays valid', () => {
    new SchemaValidator().validate(SduiPayload.fromJSON(fixture('valid/dashboard.json')))
  })
})

describe('SchemaValidator', () => {
  const validator = new SchemaValidator()
  const payload = (root: SduiNode, extra: ConstructorParameters<typeof ScreenSpec>[2] = {}) => new SduiPayload('1.1', new ScreenSpec('s', root, extra))
  const kind = (run: () => void) => { try { run(); return 'ok' } catch (e) { return (e as SduiError).kind } }

  it('rejects raw URLs and missing targets', () => {
    expect(kind(() => validator.validate(payload(new SduiNode({ type: 'button', action: new ActionSpec({ type: 'openURL', link: 'https://evil.example.com' }) }))))).toBe('schema')
    expect(kind(() => validator.validate(payload(new SduiNode({ type: 'button', action: new ActionSpec({ type: 'native' }) }))))).toBe('schema')
    expect(kind(() => validator.validate(payload(new SduiNode({ type: 'button', action: new ActionSpec({ type: 'toast' }) }))))).toBe('schema')
  })

  it('versions: MAJOR.MINOR, same major accepted, other major rejected', () => {
    expect(kind(() => validator.validate(new SduiPayload('1', new ScreenSpec('s', new SduiNode({ type: 'text' })))))).toBe('schema')
    expect(kind(() => validator.validate(new SduiPayload('1.9', new ScreenSpec('s', new SduiNode({ type: 'text' })))))).toBe('ok')
    expect(kind(() => validator.validate(new SduiPayload('2.0', new ScreenSpec('s', new SduiNode({ type: 'text' })))))).toBe('unsupportedVersion')
  })

  it('bounds: depth, nodes (shared across variants), chain, load count', () => {
    let deep = new SduiNode({ type: 'text' })
    for (let i = 0; i < 40; i++) deep = new SduiNode({ type: 'vstack', children: [deep] })
    expect(kind(() => validator.validate(payload(deep)))).toBe('bounds')

    const small = new SchemaValidator({ bounds: new SduiBounds({ maxNodes: 3 }) })
    const two = new SduiNode({ type: 'vstack', children: [new SduiNode({ type: 'text' })] })
    expect(kind(() => small.validate(payload(two)))).toBe('ok')
    expect(kind(() => small.validate(payload(two, { variants: { wide: two } })))).toBe('bounds')

    let action = new ActionSpec({ type: 'refresh' })
    for (let i = 0; i < 5; i++) action = new ActionSpec({ type: 'navigate', screen: 's', onSuccess: action })
    expect(kind(() => validator.validate(payload(new SduiNode({ type: 'button', action }))))).toBe('bounds')

    const load = Array.from({ length: 9 }, (_, i) => ({ request: `r${i}` }))
    expect(kind(() => validator.validate(payload(new SduiNode({ type: 'text' }), { load })))).toBe('bounds')
    expect(kind(() => validator.validate(payload(new SduiNode({ type: 'text' }), { load: [{ request: 'bad-name' }] })))).toBe('schema')
  })
})

describe('tokens and data', () => {
  const data = new DataContext({ name: 'Ada', count: 3, user: { name: 'Grace' }, form: { amount: 150000 } })
  const lookup = (k: string) => data.value(k)

  it('interpolates, fail-soft', () => {
    expect(TokenResolver.resolve('Hi {{ name }}/{{count}}/{{user.name}}/[{{nope}}]', lookup)).toBe('Hi Ada/3/Grace/[]')
    expect(TokenResolver.resolve('a {{oops', lookup)).toBe('a {{oops')
    expect(tokenKeys('{{a.b}} and {{ c }}')).toEqual(['a.b', 'c'])
  })

  it('a single-token param keeps its type; templates interpolate', () => {
    const params: SduiProps = { amount: '{{form.amount}}', note: 'Pay {{form.amount}}', nested: { who: '{{user.name}}' } }
    expect(resolveValue(params, lookup)).toEqual({ amount: 150000, note: 'Pay 150000', nested: { who: 'Grace' } })
  })

  it('merge notifies observers', () => {
    const d = new DataContext()
    let calls = 0
    const off = d.subscribe(() => { calls++ })
    d.merge({ a: 1 })
    off()
    d.merge({ a: 2 })
    expect(calls).toBe(1)
  })
})
