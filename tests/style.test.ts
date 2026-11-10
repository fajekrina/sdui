import { describe, expect, it } from 'vitest'
import {
  TOKENS,
  resolveSpacing,
  buildLayoutStyle,
  styleObjectToCssText,
  validateDistanceProps,
} from '../src/core/style'

describe('TOKENS + resolveSpacing', () => {
  it('resolves known tokens', () => {
    expect(resolveSpacing('md', 'fallback')).toBe('12px')
    expect(resolveSpacing('2xl', 'fallback')).toBe('32px')
  })
  it('passes through raw values, falls back on empty', () => {
    expect(resolveSpacing('18px', 'fallback')).toBe('18px')
    expect(resolveSpacing('', 'fallback')).toBe('fallback')
    expect(resolveSpacing(undefined, 'fallback')).toBe('fallback')
  })
  it('TOKENS has the 6 documented sizes', () => {
    expect(Object.keys(TOKENS).sort()).toEqual(['2xl', 'lg', 'md', 'sm', 'xl', 'xs'])
  })
})

describe('buildLayoutStyle presets', () => {
  it('Button neutral defaults', () => {
    const s = buildLayoutStyle('Button', {}, {})
    expect(s.display).toBe('inline-flex')
    expect(s.borderRadius).toBe('8px')
    expect(s.backgroundColor).toBe('#ffffff')
  })
  it('comp.style always wins over preset', () => {
    const s = buildLayoutStyle('Button', {}, { backgroundColor: '#000000', borderRadius: '0' })
    expect(s.backgroundColor).toBe('#000000')
    expect(s.borderRadius).toBe('0')
  })
  it('Flex maps direction/justify/gap', () => {
    const s = buildLayoutStyle('Flex', { direction: 'column', justify: 'between', gap: 'md' }, {})
    expect(s.display).toBe('flex')
    expect(s.flexDirection).toBe('column')
    expect(s.justifyContent).toBe('space-between')
    expect(s.gap).toBe('12px')
  })
  it('Grid clamps columns to 1..12', () => {
    expect(buildLayoutStyle('Grid', { columns: 99 }, {}).gridTemplateColumns).toContain('repeat(12,')
    expect(buildLayoutStyle('Grid', { columns: 0 }, {}).gridTemplateColumns).toContain('repeat(2,')
    expect(buildLayoutStyle('Grid', {}, {}).gridTemplateColumns).toContain('repeat(2,')
  })
  it('Space uses token height', () => {
    expect(buildLayoutStyle('Space', { height: 'lg' }, {}).height).toBe('16px')
  })
  it('unknown type returns style untouched', () => {
    expect(buildLayoutStyle('Nope', {}, { color: 'red' })).toEqual({ color: 'red' })
  })
})

describe('styleObjectToCssText', () => {
  it('camelCase to kebab-case', () => {
    expect(styleObjectToCssText({ backgroundColor: '#fff', fontSize: '14px' })).toBe(
      'background-color:#fff;font-size:14px'
    )
  })
  it('empty for non-objects', () => {
    expect(styleObjectToCssText(undefined)).toBe('')
  })
})

describe('validateDistanceProps', () => {
  it('flags bad Grid columns', () => {
    expect(validateDistanceProps('Grid', { columns: 99 }).length).toBe(1)
    expect(validateDistanceProps('Grid', { columns: 3 })).toEqual([])
  })
  it('flags bad Flex direction/justify', () => {
    expect(validateDistanceProps('Flex', { direction: 'diagonal' }).length).toBe(1)
    expect(validateDistanceProps('Flex', { justify: 'everywhere' }).length).toBe(1)
    expect(validateDistanceProps('Flex', { direction: 'row', justify: 'center' })).toEqual([])
  })
})
