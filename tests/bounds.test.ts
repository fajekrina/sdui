// HLD Target §7.5: every number in spec/bounds.json has a payload AT the limit (accepted)
// and one just OVER it (rejected). The payloads are generated here instead of committed as
// fixtures, so the published `spec/` stays small (a 5001-node screen is >100 KB). Adding a
// bound to bounds.json without a generator below fails this file.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import { SchemaValidator, SduiPayload, utf8 } from '../src/core'
import { ROOT } from './helpers'

type Json = Record<string, unknown>
const bounds = JSON.parse(readFileSync(resolve(ROOT, 'spec/bounds.json'), 'utf8')) as Record<string, number>
const { $comment: _c, schemaVersion: _v, ...limits } = bounds as Record<string, unknown>
const schema = JSON.parse(readFileSync(resolve(ROOT, 'spec/sdui.schema.json'), 'utf8'))
const ajv = new Ajv2020({ strict: false }).compile(schema)

const text = (value = 'x'): Json => ({ type: 'text', props: { value } })
const payload = (root: Json, extra: Json = {}): Json => ({ schemaVersion: '1.1', screen: { key: 'bounds', root, ...extra } })

/// `n` nodes in total: a root vstack holding groups of (one vstack + up to 255 texts).
function nodes(n: number): Json {
  const groups: Json[] = []
  let left = n - 1
  while (left > 0) {
    const kids = Math.min(255, left - 1)
    groups.push({ type: 'vstack', children: Array.from({ length: kids }, () => text()) })
    left -= kids + 1
  }
  return { type: 'vstack', children: groups }
}

function nested(depth: number): Json {
  let node: Json = text()
  for (let d = 1; d < depth; d++) node = { type: 'vstack', children: [node] }
  return node
}

function chain(depth: number): Json {
  let action: Json = { type: 'toast', message: 'x' }
  for (let d = 1; d < depth; d++) action = { type: 'toast', message: 'x', onSuccess: action }
  return action
}

/// payload with the bound at exactly `n`; `schema` = whether the JSON Schema also expresses it
const GENERATORS: Record<string, { schema: boolean; make: (n: number) => Json }> = {
  maxDepth: { schema: false, make: (n) => payload(nested(n)) },
  maxNodes: { schema: false, make: (n) => payload(nodes(n)) },
  maxStringLength: { schema: true, make: (n) => payload(text('a'.repeat(n))) },
  maxProps: { schema: true, make: (n) => payload({ type: 'text', props: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, 'x'])) }) },
  maxChildren: { schema: true, make: (n) => payload({ type: 'vstack', children: Array.from({ length: n }, () => text()) }) },
  maxArrayItems: { schema: true, make: (n) => payload({ type: 'text', props: { value: 'x', items: Array.from({ length: n }, (_, i) => i) } }) },
  maxIdentifierLength: { schema: true, make: (n) => payload({ type: 'button', props: { title: 'go' }, action: { type: 'navigate', screen: 'a'.repeat(n) } }) },
  maxChainDepth: { schema: false, make: (n) => payload({ type: 'button', props: { title: 'go' }, action: chain(n) }) },
  maxLoadRequests: { schema: true, make: (n) => payload(text(), { load: Array.from({ length: n }, (_, i) => ({ request: `r${i}` })) }) }
}

const validator = new SchemaValidator()
const client = (json: Json) => validator.validate(SduiPayload.fromJSON(utf8(JSON.stringify(json))))

describe('spec/bounds.json — generated at-limit / over-limit payloads', () => {
  it('every bound has a generator', () => {
    expect(Object.keys(GENERATORS).sort()).toEqual(Object.keys(limits).sort())
  })

  it.each(Object.entries(GENERATORS))('%s: at the limit is accepted, one over is rejected', (name, { schema: inSchema, make }) => {
    const n = bounds[name]!
    const at = make(n)
    const over = make(n + 1)

    expect(() => client(at)).not.toThrow()
    expect(() => client(over)).toThrow(expect.objectContaining({ kind: expect.stringMatching(/^(bounds|schema)$/) }))

    expect(ajv(at), JSON.stringify(ajv.errors)).toBe(true)
    // the schema rejects what it can express; recursion limits are client-only
    expect(ajv(over)).toBe(!inSchema)
  })
})
