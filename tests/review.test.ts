// HLD Target F5 · Studio for review: diff(base, next), readOnly, onSubmitForReview,
// baseline changes panel, catalog names.
import { describe, expect, it } from 'vitest'
import { EditorDocument, diff, mountStudio } from '../src/builder'

const payload = (root: unknown, extra: Record<string, unknown> = {}) => ({ schemaVersion: '1.1', screen: { key: 'home', root, ...extra } })
const text = (value: string, id?: string) => ({ type: 'text', ...(id ? { id } : {}), props: { value } })

describe('diff(base, next)', () => {
  it('no changes → empty', () => {
    const p = payload({ type: 'vstack', children: [text('a'), text('b')] })
    expect(diff(p, JSON.parse(JSON.stringify(p)))).toEqual([])
  })

  it('prop, action, added and removed nodes; screen-level load', () => {
    const base = payload({ type: 'vstack', children: [text('Hello'), { type: 'button', props: { title: 'Go' }, action: { type: 'navigate', screen: 'a' } }] })
    const next = payload({ type: 'vstack', children: [text('Hi'), { type: 'button', props: { title: 'Go' }, action: { type: 'navigate', screen: 'b' } }, { type: 'divider' }] },
      { load: [{ request: 'getBalance' }] })
    expect(diff(base, next)).toEqual([
      { kind: 'added', path: 'screen', field: 'load', before: undefined, after: [{ request: 'getBalance' }] },
      { kind: 'changed', path: 'root/text[0]', type: 'text', field: 'props.value', before: 'Hello', after: 'Hi' },
      { kind: 'changed', path: 'root/button[0]', type: 'button', field: 'action', before: { type: 'navigate', screen: 'a' }, after: { type: 'navigate', screen: 'b' } },
      { kind: 'added', path: 'root/divider[0]', type: 'divider' }
    ])
    expect(diff(next, base).map((c) => c.kind)).toEqual(['removed', 'changed', 'changed', 'removed'])
  })

  it('inserting a node of another type does not mark its siblings as changed', () => {
    const base = payload({ type: 'vstack', children: [text('a'), text('b')] })
    const next = payload({ type: 'vstack', children: [{ type: 'image', props: { name: 'logo' } }, text('a'), text('b')] })
    expect(diff(base, next)).toEqual([{ kind: 'added', path: 'root/image[0]', type: 'image' }])
  })

  it('nodes with explicit ids are matched by id: moves and reorders are reported as such', () => {
    const base = payload({ type: 'vstack', children: [{ type: 'card', id: 'box', children: [text('x', 'title')] }, text('y', 'note')] })
    const next = payload({ type: 'vstack', children: [text('y', 'note'), { type: 'card', id: 'box', children: [] }, text('x', 'title')] })
    const changes = diff(base, next)
    expect(changes).toContainEqual({ kind: 'moved', path: '#title', type: 'text', field: 'parent', before: '#box', after: 'root' })
    expect(changes).toContainEqual({ kind: 'moved', path: '#note', type: 'text', field: 'order', before: 1, after: 0 })
  })

  it('no baseline (a new screen): everything is added', () => {
    expect(diff(undefined, payload(text('a'))).map((c) => [c.kind, c.path])).toEqual([['added', 'screen'], ['added', 'root']])
  })
})

function studioWith(options: Parameters<typeof mountStudio>[1] = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const doc = new EditorDocument()
  doc.importJSON(payload({ type: 'vstack', children: [text('Hello'), { type: 'image', props: { name: 'logo' } }] }))
  const studio = mountStudio(host, { document: doc, ...options })
  const buttons = () => [...host.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.textContent)
  return { host, doc, studio, buttons, done: () => { studio.destroy(); host.remove() } }
}

describe('Studio · readOnly', () => {
  it('hides editing controls and the palette, disables the inspector and JSON, blocks drag', () => {
    const { host, doc, studio, buttons, done } = studioWith({ readOnly: true, onSave: () => undefined, onPublish: () => undefined })
    expect(buttons()).not.toContain('Save draft')
    expect(buttons()).not.toContain('Publish')
    expect(buttons()).not.toContain('↶ Undo')
    expect(buttons()).toContain('Preview')                                  // viewing still works
    expect(host.querySelector('.pal')!.closest('[hidden]')).not.toBeNull()
    expect((host.querySelector('textarea[aria-label="Payload JSON"]') as HTMLTextAreaElement).readOnly).toBe(true)
    doc.select(doc.root.children[0]!.id)
    const controls = [...host.querySelectorAll('.insp input, .insp select, .insp textarea, .insp button')] as HTMLInputElement[]
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((c) => c.disabled)).toBe(true)
    expect(host.querySelectorAll('.device [draggable="true"], [role="tree"] [draggable="true"]').length).toBe(0)

    studio.update({ readOnly: false })                                       // e.g. the role changes
    expect(buttons()).toContain('Save draft')
    expect(host.querySelector('.pal')!.closest('[hidden]')).toBeNull()
    done()
  })
})

describe('Studio · onSubmitForReview', () => {
  it('submits the validated payload with the note; shows the status', async () => {
    const submitted: Array<[unknown, string]> = []
    const { host, buttons, done } = studioWith({ onSubmitForReview: (p, note) => { submitted.push([p, note]) } })
    expect(buttons()).toContain('Submit for review')
    const note = host.querySelector('input[aria-label="Review note"]') as HTMLInputElement
    note.value = '  new hero text  '
    ;[...host.querySelectorAll('button')].find((b) => b.textContent === 'Submit for review')!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(submitted).toHaveLength(1)
    expect(submitted[0]![1]).toBe('new hero text')
    expect((submitted[0]![0] as { screen: { key: string } }).screen.key).toBe('home')
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Submitted for review ✔')
    expect(note.value).toBe('')
    done()
  })
})

describe('Studio · baseline', () => {
  it('lists the draft changes against the active release, live', () => {
    const baseline = payload({ type: 'vstack', children: [text('Hello'), { type: 'image', props: { name: 'logo' } }] })
    const { host, doc, studio, done } = studioWith({ baseline })
    const panel = () => host.querySelector('.changes') as HTMLElement
    expect(panel().hidden).toBe(false)
    expect(panel().textContent).toContain('No changes vs. the active release')
    doc.setProp(doc.root.children[0]!.id!, 'value', 'Hi')
    expect(panel().textContent).toContain('1 change vs. the active release')
    expect(panel().textContent).toContain('props.value: "Hello" → "Hi"')
    studio.update({ baseline: undefined })
    expect(panel().hidden).toBe(true)
    done()
  })
})

describe('Studio · catalog', () => {
  it('offers catalog names to the action editor and asset names to image.name; explicit lists win', () => {
    const { host, doc, done } = studioWith({ catalog: { screens: ['home', 'checkout'], requests: ['pay'], assets: ['logo', 'hero'] }, screens: ['onlyThis'] })
    const list = (name: string) => [...host.querySelectorAll(`datalist[id$="-${name}"] option`)].map((o) => (o as HTMLOptionElement).value)
    expect(list('screens')).toEqual(['onlyThis'])
    expect(list('requests')).toEqual(['pay'])
    expect(list('assets')).toEqual(['logo', 'hero'])
    doc.select(doc.root.children[1]!.id)                                     // the image
    const nameInput = [...host.querySelectorAll('.insp label')].find((l) => l.firstChild?.textContent === 'name')!.querySelector('input')!
    expect(nameInput.getAttribute('list')).toMatch(/-assets$/)
    done()
  })
})
