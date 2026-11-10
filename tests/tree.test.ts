import { describe, expect, it } from 'vitest'
import { normalizeToLayout, getComponentType, type UniversalComponent } from '../src/core/types'
import { buildTree, flattenLayout, normalizeLayoutToTree } from '../src/core/tree'

const txt = (id: string, extra: Partial<UniversalComponent> = {}): UniversalComponent =>
  ({ id, type: 'Text', props: { content: id }, ...extra })

describe('normalizeToLayout accepts 4 shapes', () => {
  it('page config with layout', () => {
    const layout = normalizeToLayout({ pageId: 'p', layout: { components: [txt('a')] } })
    expect(layout?.components?.length).toBe(1)
  })
  it('bare layout', () => {
    const layout = normalizeToLayout({ components: [txt('a')] })
    expect(layout?.components?.length).toBe(1)
  })
  it('components array', () => {
    const layout = normalizeToLayout([txt('a'), txt('b')])
    expect(layout?.components?.length).toBe(2)
  })
  it('single component', () => {
    const layout = normalizeToLayout(txt('a'))
    expect(layout?.components?.length).toBe(1)
  })
  it('nullish returns null', () => {
    expect(normalizeToLayout(null)).toBeNull()
    expect(normalizeToLayout(undefined)).toBeNull()
  })
})

describe('getComponentType reads type or component', () => {
  it('prefers type', () => {
    expect(getComponentType({ id: 'x', type: 'Button', component: 'Text' } as UniversalComponent)).toBe('Button')
  })
  it('falls back to component', () => {
    expect(getComponentType({ id: 'x', component: 'Card' } as UniversalComponent)).toBe('Card')
  })
})

describe('buildTree', () => {
  it('keeps nested children and sorts by order', () => {
    const roots = buildTree([
      txt('b', { order: 2 }),
      { ...txt('a', { order: 1 }), children: [txt('a1', { order: 1 })] },
    ])
    expect(roots.map((r) => r.id)).toEqual(['a', 'b'])
    expect(roots[0]?.children.map((c) => c.id)).toEqual(['a1'])
  })
  it('links flat parentId/order', () => {
    const roots = buildTree([
      txt('child', { parentId: 'root', order: 0 } as Partial<UniversalComponent>),
      txt('root', { order: 0 }),
    ])
    expect(roots.map((r) => r.id)).toEqual(['root'])
    expect(roots[0]?.children.map((c) => c.id)).toEqual(['child'])
  })
  it('empty in, empty out', () => {
    expect(buildTree([])).toEqual([])
  })
})

describe('flattenLayout / normalizeLayoutToTree', () => {
  it('flatten returns components or []', () => {
    expect(flattenLayout({ components: [txt('a')] }).length).toBe(1)
    expect(flattenLayout(null)).toEqual([])
  })
  it('normalize builds trees', () => {
    const trees = normalizeLayoutToTree({ components: [txt('a')] })
    expect(trees.length).toBe(1)
    expect(normalizeLayoutToTree(null)).toEqual([])
  })
})
