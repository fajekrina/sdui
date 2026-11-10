import { describe, it, expect } from 'vitest'
import { findComponentJsonRange } from '../src/builder/builder'

const comps = [
  { id: 'a1', type: 'Container', props: { id: 'b2' } },
  { id: 'b2', type: 'Button', parentId: 'a1', props: { label: 'id "x" }' } },
]
const text = JSON.stringify(comps, null, 2)
const lines = text.split('\n')

describe('findComponentJsonRange', () => {
  it('returns the line range of the top-level item with that id', () => {
    const r = findComponentJsonRange(text, 'b2')!
    expect(lines[r.startLine]!.trim()).toBe('{')
    expect(lines[r.endLine]!.trim()).toBe('}')
    expect(lines.slice(r.startLine, r.endLine + 1).join('\n')).toContain('"type": "Button"')
  })
  it('ignores nested "id" keys (props.id) and string contents', () => {
    const r = findComponentJsonRange(text, 'a1')!
    expect(r.startLine).toBe(1)
    expect(lines.slice(r.startLine, r.endLine + 1).join('\n')).toContain('"type": "Container"')
    expect(lines.slice(r.startLine, r.endLine + 1).join('\n')).not.toContain('Button')
  })
  it('works on compact / hand-edited text and returns null when absent', () => {
    expect(findComponentJsonRange(JSON.stringify(comps), 'b2')).toEqual({ startLine: 0, endLine: 0 })
    expect(findComponentJsonRange(text, 'zz')).toBeNull()
    expect(findComponentJsonRange(text, null)).toBeNull()
    expect(findComponentJsonRange('[{"id": "b2", ', 'b2')).toBeNull()
  })
})
