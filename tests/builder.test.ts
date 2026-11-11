import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as DSL from '../src/builder'
import {
  DSLExport, EditorDocument, api, button, findNodeJsonRange, form, list, mountStudio, navigate, native, renderPreview,
  screen, text, textField, toast, vstack
} from '../src/builder'
import { ComponentFactory, SduiError, SduiNode, SduiPayload } from '../src/core'
import { ROOT, fixture } from './helpers'

describe('DSL', () => {
  const sample = () => screen('home', vstack({ spacing: 12 }, [
    text('Halo, {{user.name}}', { style: 'title' }),
    false,
    ['a', 'b'].map((w) => text(w)),
    button('Detail', navigate('productDetail', { presentation: 'sheet' }))
  ]), { load: [{ request: 'getBalance' }] })

  it('builds, validates, encodes', () => {
    const json = sample().validated().toJSON() as { screen: { root: { children: unknown[] }; load: unknown[] } }
    expect(json.screen.root.children).toHaveLength(4)
    expect(json.screen.load).toEqual([{ request: 'getBalance' }])
    expect(() => screen('s', button('x', DSL.openURL('https://evil.example.com'))).validated()).toThrow(SduiError)
  })

  it('rebuilds the transfer_form fixture exactly', () => {
    const built = screen('transferForm', form({ padding: 16, spacing: 12 }, [
      text('Transfer', { style: 'title', weight: 'bold' }),
      textField({ name: 'account', label: 'Destination account', required: true, pattern: 'numeric', minLength: 10, maxLength: 16 }),
      textField({ name: 'amount', label: 'Amount', keyboard: 'number', required: true, pattern: 'amount' }),
      DSL.picker({ name: 'purpose', label: 'Purpose', options: [{ value: 'family', label: 'Family' }, { value: 'bills', label: 'Bills' }] }),
      DSL.textArea({ name: 'note', label: 'Note', maxLength: 140 }),
      textField({ name: 'pin', label: 'PIN', secure: true, keyboard: 'number', required: true, pattern: 'pin6' }),
      button('Send', native('biometricConfirm', {
        params: { reason: 'Confirm transfer of {{form.amount}}' },
        onSuccess: api('createTransfer', {
          params: { account: '{{form.account}}', amount: '{{form.amount}}', purpose: '{{form.purpose}}' },
          onSuccess: toast('Sent {{form.amount}}', { level: 'success', onSuccess: DSL.dismiss() }),
          onError: toast('Transfer failed', { level: 'error' })
        }),
        onError: toast('Confirmation cancelled', { level: 'warning' })
      }), { a11yId: 'send_button' })
    ]).id('transfer'))
    expect(built.payload.equals(SduiPayload.fromJSON(fixture('valid/transfer_form.json')))).toBe(true)
  })

  it('DSL export is lossless: evaluating the source rebuilds the same payload', () => {
    for (const name of ['valid/transfer_form.json', 'valid/home_load.json', 'valid/dashboard.json', 'valid/third_party_lottie.json']) {
      const original = SduiPayload.fromJSON(fixture(name))
      const source = DSLExport.source(original)
      const rebuilt = new Function(...Object.keys(DSL), `return ${source}`)(...Object.values(DSL)) as DSL.ScreenBuilder
      const expected = new SduiPayload(original.schemaVersion, original.screen)
      expect(rebuilt.payload.equals(expected), `${name}\n${source}`).toBe(true)
    }
  })
})

describe('EditorDocument', () => {
  it('add into the selected container, move, duplicate, delete, undo/redo, no-op edits', () => {
    const doc = new EditorDocument()
    const rootId = doc.root.id!
    doc.select(rootId)
    const t = doc.add('text')
    const b = doc.add('button')                       // selection is the text → inserted after it
    expect(doc.root.children.map((c) => c.id)).toEqual([t, b])
    doc.move(b, -1)
    expect(doc.root.children.map((c) => c.id)).toEqual([b, t])
    doc.duplicate(t)
    expect(doc.root.children).toHaveLength(3)
    doc.delete(t)
    expect(doc.root.children).toHaveLength(2)
    doc.undo(); doc.undo()
    expect(doc.root.children).toHaveLength(2)
    doc.redo()
    expect(doc.root.children).toHaveLength(3)
    const before = doc.canRedo
    doc.setProp(b, 'title', 'Button')                 // unchanged value → no history entry
    expect(doc.canRedo).toBe(before)
  })

  it('exports validated JSON with generated ids stripped (authored ids kept)', () => {
    const doc = new EditorDocument({ key: 'home', root: new SduiNode({ id: 'main', type: 'vstack' }) })
    doc.select('main')
    doc.add('text')
    const out = JSON.parse(doc.exportJSON())
    expect(out.screen.root.id).toBe('main')
    expect(out.screen.root.children[0].id).toBeUndefined()
    doc.setAction(doc.root.children[0]!.id!, undefined)
    expect(doc.issues()).toEqual([])
  })

  it('imports a legacy page through fromUniversal, with warnings', () => {
    const doc = new EditorDocument()
    doc.importJSON(JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/legacy/merchant_demo-home.json'), 'utf8')))
    expect(doc.key).toBe('home')
    expect(doc.importWarnings.length).toBeGreaterThan(0)
    expect(doc.issues()).toEqual([])
  })

  it('exports DSL', () => {
    const doc = new EditorDocument({ key: 'home', root: new SduiNode({ type: 'vstack', children: [new SduiNode({ type: 'text', props: { value: 'hi' } })] }) })
    expect(doc.exportDSL()).toBe('screen("home", vstack([\n  text("hi"),\n]))')
  })
})

describe('preview + JSON panel helpers', () => {
  it('preview uses the client components and tags nodes for selection', () => {
    const root = new SduiNode({ id: 'a', type: 'vstack', children: [new SduiNode({ id: 'b', type: 'text', props: { value: 'x' } })] })
    const view = renderPreview(ComponentFactory.withBuiltins(), root, { selected: 'b' })!
    expect(view.attrs['data-sdui-node']).toBe('a')
    expect(view.children[0]!.style.outline).toContain('2px')
  })

  it('finds the line range of a nested node by id', () => {
    const json = JSON.stringify({ screen: { root: { id: 'a', type: 'vstack', children: [{ id: 'b', type: 'text', props: { id: 'decoy' } }] } } }, null, 2)
    const range = findNodeJsonRange(json, 'b')!
    const lines = json.split('\n').slice(range.startLine, range.endLine + 1).join('\n')
    expect(lines).toContain('"type": "text"')
    expect(lines).not.toContain('vstack')
    expect(findNodeJsonRange(json, 'zz')).toBeNull()
  })
})

describe('Studio (DOM)', () => {
  it('mounts, adds from the palette, selects from the canvas, edits props, exports', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const saved: unknown[] = []
    const studio = mountStudio(host, { onSave: (p) => { saved.push(p) } })
    const paletteText = [...host.querySelectorAll('.pal button')].find((b) => b.textContent === 'text') as HTMLButtonElement
    paletteText.click()
    const id = studio.document.selection!
    expect(studio.document.selected?.type).toBe('text')
    const valueInput = [...host.querySelectorAll('.insp label')].find((l) => l.firstChild?.textContent === 'value')!.querySelector('input')!
    valueInput.value = 'Hello'
    valueInput.dispatchEvent(new Event('change'))
    expect(host.querySelector('.device')!.textContent).toContain('Hello')
    studio.document.select(undefined)
    ;(host.querySelector(`[data-sdui-node="${id}"]`) as HTMLElement).click()
    expect(studio.document.selection).toBe(id)
    expect(host.querySelector('.json .badge')!.textContent).toContain('text')
    ;[...host.querySelectorAll('.tb button')].find((b) => b.textContent === 'Save draft')!.dispatchEvent(new Event('click'))
    await new Promise((r) => setTimeout(r, 0))
    expect((saved[0] as { screen: { key: string } }).screen.key).toBe('screen')
    studio.destroy()
    expect(host.children).toHaveLength(0)
  })

  it('collapses the JSON panel', () => {
    const host = document.createElement('div')
    const studio = mountStudio(host)
    const toggle = host.querySelector('.json .hd button') as HTMLButtonElement
    toggle.click()
    expect((host.querySelector('.json .body') as HTMLElement).style.display).toBe('none')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    studio.destroy()
  })
})

describe('DSL helpers', () => {
  it('list with a row template', () => {
    const node = list({ items: 'promos', as: 'p' }, [text('{{p.title}}')]).node()
    expect(node.children).toHaveLength(1)
    expect(node.string('items')).toBe('promos')
  })
})
