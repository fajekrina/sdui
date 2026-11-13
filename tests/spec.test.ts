// Phase 0 gate: the spec (JSON Schema + fixtures) and the client validator agree.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import { SchemaValidator, SduiBounds, SduiEnvelope, SduiPayload } from '../src/core'
import { ROOT, fixture, fixtureJSON, fixtureNames } from './helpers'

const schema = JSON.parse(readFileSync(resolve(ROOT, 'spec/sdui.schema.json'), 'utf8'))
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema)

describe('spec/sdui.schema.json', () => {
  it.each(fixtureNames('valid'))('valid/%s passes the schema', (name) => {
    expect(validate(fixtureJSON(`valid/${name}`)), JSON.stringify(validate.errors)).toBe(true)
  })

  it.each(fixtureNames('invalid'))('invalid/%s is rejected by the schema', (name) => {
    expect(validate(fixtureJSON(`invalid/${name}`))).toBe(false)
  })
})

describe('client validator vs spec fixtures', () => {
  const validator = new SchemaValidator()

  it.each(fixtureNames('valid'))('valid/%s decodes and validates', (name) => {
    const raw = fixture(`valid/${name}`)
    const payload = name === 'envelope.json' ? SduiPayload.fromJSON(SduiEnvelope.fromJSON(raw).payload) : SduiPayload.fromJSON(raw)
    validator.validate(payload)
  })

  // Unknown structural keys are a schema-layer rejection (CI + backend). The client
  // ignores them by policy (forward-compatible minors) — and so never acts on them.
  const SCHEMA_ONLY = new Set(['action_extra_key.json', 'node_extra_key.json', 'api_raw_url.json', 'variants_unknown_key.json'])

  it.each(fixtureNames('invalid').filter((n) => !SCHEMA_ONLY.has(n)))('invalid/%s is rejected by decode or validation', (name) => {
    expect(() => validator.validate(SduiPayload.fromJSON(fixture(`invalid/${name}`)))).toThrow()
  })

  it.each([...SCHEMA_ONLY])('invalid/%s: the unknown keys are dropped, never used', (name) => {
    const payload = SduiPayload.fromJSON(fixture(`invalid/${name}`))
    const json = JSON.stringify(payload.toJSON())
    expect(json).not.toContain('unexpected')
    expect(json).not.toContain('https://')
    expect(json).not.toContain('tablet')
  })
})

// F1: one source of bounds — the published spec/bounds.json, the schema, and the client defaults agree
describe('spec/bounds.json', () => {
  const bounds = JSON.parse(readFileSync(resolve(ROOT, 'spec/bounds.json'), 'utf8')) as Record<string, unknown>
  const { $comment: _comment, schemaVersion, ...numbers } = bounds
  const defs = schema.$defs

  it('is what SduiBounds.default is built from (every field, nothing else)', () => {
    expect(schemaVersion).toBe('1.1')
    expect(numbers).toEqual({ ...SduiBounds.default })
  })

  it('matches every bound the schema also expresses', () => {
    expect(defs.value.anyOf.find((v: { type: string }) => v.type === 'string').maxLength).toBe(numbers.maxStringLength)
    expect(defs.value.anyOf.find((v: { type: string }) => v.type === 'array').maxItems).toBe(numbers.maxArrayItems)
    expect(defs.value.anyOf.find((v: { type: string }) => v.type === 'object').maxProperties).toBe(numbers.maxProps)
    expect(defs.props.maxProperties).toBe(numbers.maxProps)
    expect(defs.node.properties.children.maxItems).toBe(numbers.maxChildren)
    expect(defs.identifier.maxLength).toBe(numbers.maxIdentifierLength)
    expect(defs.screen.properties.load.maxItems).toBe(numbers.maxLoadRequests)
  })
})
