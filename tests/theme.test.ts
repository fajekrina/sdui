import { describe, expect, it } from 'vitest'
import { resolveTokenRef, applyThemeToStyle, resolveThemeTokens, type UniversalTheme } from '../src/core/theme'
import type { UniversalComponent } from '../src/core/types'

const asComps = (o: unknown): UniversalComponent[] => o as UniversalComponent[]

const theme: UniversalTheme = {
  version: '3',
  tokens: { brand: { primary: '#6c8cff', radius: '12px' }, space: { md: '12px' } },
}

describe('resolveTokenRef', () => {
  it('resolves Category.name against the theme', () => {
    expect(resolveTokenRef('brand.primary', theme)).toBe('#6c8cff')
    expect(resolveTokenRef('space.md', theme)).toBe('12px')
  })
  it('returns undefined for unknown, malformed or non-string refs', () => {
    expect(resolveTokenRef('brand.missing', theme)).toBeUndefined()
    expect(resolveTokenRef('no-dot-here', theme)).toBeUndefined()
    expect(resolveTokenRef('brand.', theme)).toBeUndefined()
    expect(resolveTokenRef('', theme)).toBeUndefined()
    expect(resolveTokenRef('brand.primary', {})).toBeUndefined()
  })
})

describe('applyThemeToStyle', () => {
  it('style wins over token, token fills gaps', () => {
    const merged = applyThemeToStyle(
      { color: 'red' },
      { color: 'brand.primary', backgroundColor: 'brand.primary', gap: 'space.md' },
      theme
    )
    expect(merged).toEqual({ color: 'red', backgroundColor: '#6c8cff', gap: '12px' })
  })
  it('ignores unknown tokens (fail-soft)', () => {
    const merged = applyThemeToStyle({}, { color: 'nope.missing' }, theme)
    expect(merged).toEqual({})
  })
  it('tolerates missing token objects', () => {
    expect(applyThemeToStyle({ color: 'red' }, undefined, theme)).toEqual({ color: 'red' })
  })
})

describe('resolveThemeTokens', () => {
  it('merges tokens into style without mutating inputs', () => {
    const comps = asComps([
      { id: 'a', type: 'Card', style: {}, token: { backgroundColor: 'brand.primary' }, children: [] },
      { id: 'b', type: 'Text', props: { content: 'x' } },
    ])
    const out = resolveThemeTokens(comps, theme)
    expect((out[0]!.style as Record<string, unknown>).backgroundColor).toBe('#6c8cff')
    expect(out[1]).toEqual({ id: 'b', type: 'Text', props: { content: 'x' } })
    expect(comps[0]!.style).toEqual({})
  })
  it('recurses into children', () => {
    const out = resolveThemeTokens(
      asComps([{ id: 'p', type: 'Card', children: [{ id: 'c', type: 'Text', style: {}, token: { color: 'brand.primary' } }] }]),
      theme
    )
    expect(((out[0]!.children as unknown[])[0] as { style: Record<string, string> }).style.color).toBe('#6c8cff')
  })
  it('passes components through when theme is missing', () => {
    const comps = asComps([{ id: 'a', type: 'Text' }])
    expect(resolveThemeTokens(comps, undefined)).toEqual(comps)
    expect(resolveThemeTokens(undefined, theme)).toEqual([])
  })
})
