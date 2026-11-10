import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeToLayout, type UniversalLayout } from '../src/core/types'
import { DEFAULT_BOUNDS, toErrorPage, errorKindOf, validateLayout, warnValidation } from '../src/core/validate'

/** Intentionally-invalid payloads must bypass TS narrowing to reach the validator. */
const L = (o: unknown): UniversalLayout => o as UniversalLayout

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const policy = {
  merchantId: 'merchant_demo',
  policyVersion: '7',
  allowedDomains: ['example.com', 'cdn.example.com'],
  allowedEvents: ['addToCart'],
}

describe('valid payloads stay clean', () => {
  it('showcase-18 fixture: no errors with or without policy', () => {
    const page = load('../fixtures/valid/showcase-18.json')
    expect(validateLayout(normalizeToLayout(page))).toEqual([])
    expect(validateLayout(normalizeToLayout(page), { policy })).toEqual([])
  })
})

describe('bounds (port of MurtiBounds)', () => {
  it(`rejects more than ${DEFAULT_BOUNDS.maxNodes} nodes`, () => {
    const big = {
      components: Array.from({ length: DEFAULT_BOUNDS.maxNodes + 1000 }, (_, i) => ({
        id: `n${i}`,
        type: 'Text',
        props: { content: 'x' },
      })),
    }
    const errors = validateLayout(L(big))
    expect(errors.some((e) => e.code === 'bounds' && e.message.includes('node count'))).toBe(true)
  })
  it(`rejects depth over ${DEFAULT_BOUNDS.maxDepth}`, () => {
    let root: Record<string, unknown> = { id: 'd0', type: 'Container', children: [] }
    let cur = root
    for (let i = 1; i <= DEFAULT_BOUNDS.maxDepth + 8; i++) {
      const next: Record<string, unknown> = { id: `d${i}`, type: 'Container', children: [] }
      ;(cur.children as unknown[]).push(next)
      cur = next
    }
    const errors = validateLayout({ components: [root] } as never)
    expect(errors.some((e) => e.code === 'bounds' && e.message.includes('depth'))).toBe(true)
  })
  it('rejects overlong strings and ids', () => {
    const errors = validateLayout(L({
      components: [{ id: 'x'.repeat(200), type: 'Text', props: { content: 'y'.repeat(5000) } }],
    }))
    expect(errors.some((e) => e.code === 'bounds' && e.message.includes('string length'))).toBe(true)
    expect(errors.some((e) => e.code === 'schema' && e.message.includes('invalid component id'))).toBe(true)
  })
})

describe('identifiers and versions', () => {
  it('accepts hyphens and leading digits (ULIDs from real backends)', () => {
    const ok = validateLayout({ components: [{ id: 'btn-nav_1', type: 'Flex', props: {} }] })
    expect(ok).toEqual([])
    const ulid = validateLayout({ components: [{ id: '01HQ0000000000000000000001', type: 'Text', props: { content: 'x' } }] })
    expect(ulid).toEqual([])
    const bad = validateLayout(L({ components: [{ id: 'id rusak!', type: 'Buton Typo', props: {} }] }))
    expect(bad.some((e) => e.code === 'schema' && e.message.includes('invalid component type'))).toBe(true)
    expect(bad.some((e) => e.code === 'schema' && e.message.includes('invalid component id'))).toBe(true)
  })
  it('rejects unsupported schemaVersion majors, allows 1.x', () => {
    expect(
      validateLayout({ schemaVersion: '2.0', components: [] }).some((e) => e.code === 'unsupportedVersion')
    ).toBe(true)
    expect(validateLayout({ schemaVersion: '1.3', components: [] })).toEqual([])
    expect(validateLayout({ components: [] })).toEqual([])
  })
})

describe('actions', () => {
  it('flags unknown behaviors and missing navigate target', () => {
    const errors = validateLayout(L({
      components: [
        { id: 'a1', type: 'Button', props: { label: 'x' }, action: { behavior: 'eval' } },
        { id: 'a2', type: 'Button', props: { label: 'x' }, action: { behavior: 'navigate' } },
      ],
    }))
    expect(errors.some((e) => e.code === 'unknownAction')).toBe(true)
    expect(errors.some((e) => e.code === 'schema' && e.message.includes('navigate'))).toBe(true)
  })
  it('stays silent on domains/events without a policy', () => {
    const layout = L({
      components: [
        {
          id: 'a3',
          type: 'Button',
          props: { label: 'x' },
          action: { behavior: 'externalLink', href: 'https://evil-example.com/phish' },
        },
      ],
    })
    const errors = validateLayout(layout)
    expect(errors.some((e) => e.code === 'unlistedDomain' || e.code === 'unlistedEvent')).toBe(false)
  })
  it('enforces policy domains and events', () => {
    const errors = validateLayout(
      L({
        components: [
          {
            id: 'a3',
            type: 'Button',
            props: { label: 'x' },
            action: { behavior: 'externalLink', href: 'https://evil-example.com/phish' },
          },
          {
            id: 'a4',
            type: 'Button',
            props: { label: 'x' },
            action: { behavior: 'customEvent', eventName: 'adminWipe' },
          },
        ],
      }),
      { policy }
    )
    expect(errors.some((e) => e.code === 'unlistedDomain' && e.message.includes('evil-example.com'))).toBe(true)
    expect(errors.some((e) => e.code === 'unlistedEvent' && e.message.includes('adminWipe'))).toBe(true)
  })
  it('accepts listed domains, wildcards, true subdomains; rejects lookalikes', () => {
    const mk = (href: string): UniversalLayout => ({
      components: [{ id: 'x', type: 'Button', props: { label: 'x' }, action: { behavior: 'externalLink', href } }],
    }) as unknown as UniversalLayout
    expect(validateLayout(mk('https://cdn.example.com/a.png'), { policy })).toEqual([])
    expect(
      validateLayout(mk('https://a.b.example.com/y'), { policy: { allowedDomains: ['*.example.com'] } })
    ).toEqual([])
    expect(validateLayout(mk('https://evil.example.com/'), { policy })).toEqual([])
    const phish = validateLayout(mk('https://example.com.evil.com/'), { policy })
    expect(phish.some((e) => e.code === 'unlistedDomain')).toBe(true)
  })
})

describe('invalid fixtures stay rejected', () => {
  it('unknown-type.json', () => {
    const errors = validateLayout(normalizeToLayout(load('../fixtures/invalid/unknown-type.json')))
    expect(errors.some((e) => e.code === 'schema')).toBe(true)
  })
  it('bad-action.json without policy: eval + missing target only', () => {
    const errors = validateLayout(normalizeToLayout(load('../fixtures/invalid/bad-action.json')))
    expect(errors.some((e) => e.code === 'unknownAction')).toBe(true)
    expect(errors.some((e) => e.code === 'unlistedDomain')).toBe(false)
  })
  it('bad-version-grid.json (via warnValidation: envelope version survives normalize)', () => {
    const warns: string[] = []
    const orig = console.warn
    console.warn = (m: string) => void warns.push(m)
    try {
      const page = load('../fixtures/invalid/bad-version-grid.json')
      const errors = warnValidation(page)
      expect(errors.some((e) => e.code === 'unsupportedVersion')).toBe(true)
      expect(errors.some((e) => e.code === 'schema' && e.message.includes('columns'))).toBe(true)
    } finally {
      console.warn = orig
    }
  })
})

describe('toErrorPage', () => {
  it('builds the documented fallback shape', () => {
    const page = toErrorPage('boom')
    expect(page.pageKey).toBe('error')
    expect(page.layout?.title).toBe('Not Found')
    expect(page.layout?.subtitle).toBe('boom')
    expect(page.layout?.components?.length).toBe(1)
    expect(page.error).toEqual({ kind: 'notFound' })
  })
  it('titles the page by kind and maps error codes to kinds', () => {
    expect(toErrorPage('x', { kind: 'blocked' }).layout?.title).toBe('Blocked')
    expect(errorKindOf({ code: 'http', status: 404 })).toBe('notFound')
    expect(errorKindOf({ code: 'http', status: 401 })).toBe('forbidden')
    expect(errorKindOf({ code: 'http', status: 409 })).toBe('rejected')
    expect(errorKindOf({ code: 'http', status: 503 })).toBe('unavailable')
    expect(errorKindOf({ code: 'network' })).toBe('offline')
    expect(errorKindOf({ code: 'decode' })).toBe('invalid')
    expect(errorKindOf({ code: 'schema' })).toBe('blocked')
  })
})

describe('warnValidation', () => {
  it('returns errors and warns without throwing', () => {
    const warns: string[] = []
    const orig = console.warn
    console.warn = (m: string) => void warns.push(m)
    try {
      const errors = warnValidation({ components: [{ id: 'ok', type: 'Text', props: { content: 'x' } }] })
      expect(errors).toEqual([])
      const bad = warnValidation({ components: [{ id: 'a', type: 'Button', props: {}, action: { behavior: 'nope' } }] })
      expect(bad.some((e) => e.code === 'unknownAction')).toBe(true)
      expect(warns.some((w) => w.includes('unknownAction'))).toBe(true)
    } finally {
      console.warn = orig
    }
  })
})
