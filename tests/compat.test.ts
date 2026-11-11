import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import { fromUniversal, toIdentifier } from '../src/compat'
import { SchemaValidator, SduiPayload } from '../src/core'
import { ROOT } from './helpers'

const schema = JSON.parse(readFileSync(resolve(ROOT, 'spec/sdui.schema.json'), 'utf8'))
const validate = new Ajv2020({ strict: false }).compile(schema)
const legacy = (name: string) => JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/legacy', name), 'utf8'))
const names = readdirSync(resolve(ROOT, 'tests/fixtures/legacy')).sort()

describe('fromUniversal', () => {
  it.each(names)('%s converts to a spec payload that passes the schema and the client validator', (name) => {
    const { payload } = fromUniversal(legacy(name))
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
    new SchemaValidator().validate(SduiPayload.decode(payload))
  })

  it('identifiers: hyphens, URLs, leading digits', () => {
    expect(toIdentifier('seat-selection')).toBe('seat_selection')
    expect(toIdentifier('https://help.example.com/faq')).toBe('help_example_com_faq')
    expect(toIdentifier('123')).toBe('item')
  })

  it('maps the home page: stacks, text styles, navigate with params, link → named openURL', () => {
    const { payload, warnings } = fromUniversal(legacy('merchant_demo-home.json'))
    const json = JSON.stringify(payload)
    expect(payload.screen.key).toBe('home')
    expect(payload.screen.root.type).toBe('vstack')
    expect(json).toContain('"screen":"seat_selection"')
    expect(json).toContain('"eventId":"event-jazz-01"')
    expect(json).toContain('"type":"openURL"')
    expect(json).not.toMatch(/"(href|src|url)":/)
    expect(warnings.some((w) => w.includes('CSS without a style prop dropped'))).toBe(true)
  })

  it('maps the checkout form: fields + submit → api with {{form.*}} params', () => {
    const { payload } = fromUniversal(legacy('merchant_demo-checkout.json'))
    const json = JSON.stringify(payload)
    expect(json).toContain('"type":"form"')
    expect(json).toContain('"type":"textField"')
    expect(json).toContain('"type":"picker"')
    expect(json).toContain('"pattern":"email"')
    expect(json).toMatch(/"request":"submit_checkout","params":\{[^}]*"\{\{form\./)
  })

  it('back → dismiss; Toast/Modal components are dropped with a warning', () => {
    expect(JSON.stringify(fromUniversal(legacy('merchant_demo-seat-selection.json')).payload)).toContain('"type":"dismiss"')
    const { warnings } = fromUniversal(legacy('showcase-18.json'))
    expect(warnings.some((w) => w.includes('Toast component dropped'))).toBe(true)
  })
})
