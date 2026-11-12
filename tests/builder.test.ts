import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as DSL from '../src/builder'
import {
  DSLExport, EditorDocument, api, button, find, findNodeJsonRange, form, list, mountStudio, navigate, native, renderPreview,
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

  it('placement and reparent: containers only, never into itself, index-stable within a parent', () => {
    const doc = new EditorDocument({
      root: new SduiNode({ id: 'root', type: 'vstack', children: [
        new SduiNode({ id: 'a', type: 'text', props: { value: 'a' } }),
        new SduiNode({ id: 'box', type: 'card', children: [new SduiNode({ id: 'inner', type: 'hstack' })] }),
        new SduiNode({ id: 'b', type: 'text', props: { value: 'b' } })
      ] })
    })
    expect(doc.placement('box', 'inside')).toEqual({ parentId: 'box' })
    expect(doc.placement('a', 'inside')).toBeUndefined()            // a leaf holds no children
    expect(doc.placement('b', 'before')).toEqual({ parentId: 'root', index: 2 })
    expect(doc.placement('root', 'after')).toBeUndefined()          // nothing beside the root
    expect(doc.parentCandidates('box').map((n) => n.id)).toEqual(['root'])
    expect(doc.parentCandidates('a').map((n) => n.id)).toEqual(['root', 'box', 'inner'])

    expect(doc.reparent('box', 'inner')).toBe(false)                 // into its own descendant
    expect(doc.reparent('root', 'box')).toBe(false)
    expect(doc.reparent('a', 'b')).toBe(false)                       // into a leaf
    expect(doc.reparent('a', 'inner')).toBe(true)
    expect(find(doc.root, 'inner')!.children.map((c) => c.id)).toEqual(['a'])
    // same parent, moving down: the index means "before what is there now"
    doc.reparent('a', 'root', 0)
    expect(doc.root.children.map((c) => c.id)).toEqual(['a', 'box', 'b'])
    doc.reparent('a', 'root', 3)
    expect(doc.root.children.map((c) => c.id)).toEqual(['box', 'b', 'a'])
    doc.undo()
    expect(doc.root.children.map((c) => c.id)).toEqual(['a', 'box', 'b'])
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

  const fire = (target: Element, type: string) => target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
  const labelled = (host: Element, name: string, scope = '.insp') =>
    [...host.querySelectorAll(`${scope} label`)].find((l) => l.firstChild?.textContent === name)!

  it('drags from the palette into a container and moves nodes between containers', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const studio = mountStudio(host)
    const doc = studio.document
    const paletteItem = (type: string) => [...host.querySelectorAll('.pal button')].find((b) => b.textContent === type)!
    expect((paletteItem('card') as HTMLButtonElement).draggable).toBe(true)

    // palette → empty canvas area: lands in the root
    fire(paletteItem('card'), 'dragstart')
    fire(host.querySelector('.device')!, 'drop')
    const card = doc.root.children[0]!
    expect(card.type).toBe('card')
    expect(host.querySelector(`[data-sdui-node="${card.id}"] .hint`)!.textContent).toContain('Empty card')

    // palette → onto the card: inserted inside it
    fire(paletteItem('text'), 'dragstart')
    fire(host.querySelector(`[data-sdui-node="${card.id}"]`)!, 'drop')
    expect(find(doc.root, card.id!)!.children[0]!.type).toBe('text')
    const textId = find(doc.root, card.id!)!.children[0]!.id!
    expect(host.querySelector(`[data-sdui-node="${textId}"]`)!.getAttribute('data-label')).toBe('text')

    // outline row of the text → onto the root row: moved out of the card
    fire(host.querySelector(`[data-sdui-row="${textId}"]`)!, 'dragstart')
    fire(host.querySelector(`[data-sdui-row="${doc.root.id}"]`)!, 'drop')
    expect(doc.root.children.map((c) => c.type)).toEqual(['card', 'text'])
    expect(find(doc.root, card.id!)!.children).toHaveLength(0)

    // parent picker moves it back into the card
    doc.select(textId)
    const parent = labelled(host, 'parent').querySelector('select')!
    parent.value = card.id!
    fire(parent, 'change')
    expect(find(doc.root, card.id!)!.children.map((c) => c.id)).toEqual([textId])
    studio.destroy()
  })

  it('edits actions with a structured editor fed by the app allow-lists', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const studio = mountStudio(host, { screens: ['home', 'transfer'], requests: ['createTransfer'] })
    const id = studio.document.add('button')
    const set = (name: string, value: string, scope?: string) => {
      const control = labelled(host, name, scope).querySelector('select, input, textarea') as HTMLInputElement
      control.value = value
      fire(control, 'change')
    }
    set('type', 'navigate')
    const screenInput = labelled(host, 'screen').querySelector('input')!
    expect([...host.querySelectorAll(`#${screenInput.getAttribute('list')} option`)].map((o) => o.getAttribute('value'))).toEqual(['home', 'transfer'])
    set('screen', 'transfer')
    set('presentation', 'sheet')
    set('params (JSON)', '{"from":"home"}')
    expect(studio.document.selected!.action!.toJSON()).toEqual({ type: 'navigate', screen: 'transfer', presentation: 'sheet', params: { from: 'home' } })

    // chain: onSuccess → toast
    set('type', 'toast', '.insp details > .act')
    expect(studio.document.selected!.action!.onSuccess!.toJSON()).toEqual({ type: 'toast', message: 'Done', level: 'success' })
    set('type', '')                                                     // none removes the action
    expect(find(studio.document.root, id)!.action).toBeUndefined()
    studio.destroy()
  })

  it('update() applies lists and title that arrive after mounting', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const studio = mountStudio(host)
    expect((host.querySelector('.tb .ttl') as HTMLElement).style.display).toBe('none')
    studio.update({ title: 'demo / home', screens: ['home', 'checkout'] })
    expect(host.querySelector('.tb .ttl')!.textContent).toBe('demo / home')
    expect([...host.querySelectorAll('datalist')][0]!.querySelectorAll('option')).toHaveLength(2)
    studio.destroy()
  })

  it('toggles a full preview and reports save status', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let fail = false
    const studio = mountStudio(host, { title: 'merchant / home', onSave: () => { if (fail) throw new Error('offline') } })
    expect(host.querySelector('.tb .ttl')!.textContent).toBe('merchant / home')
    const previewBtn = [...host.querySelectorAll('.tb button')].find((b) => b.textContent === 'Preview') as HTMLButtonElement
    previewBtn.click()
    expect(host.querySelector('.main')!.classList.contains('pv')).toBe(true)
    expect((host.querySelector('.json') as HTMLElement).style.display).toBe('none')
    expect(host.querySelector('.device .hint')).toBeNull()               // no editor affordances
    expect(previewBtn.textContent).toBe('Edit')
    previewBtn.click()
    expect(host.querySelector('.main')!.classList.contains('pv')).toBe(false)

    const save = [...host.querySelectorAll('.tb button')].find((b) => b.textContent === 'Save draft') as HTMLButtonElement
    save.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(host.querySelector('.tb .st')!.textContent).toBe('Saved ✔')
    fail = true
    save.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(host.querySelector('.tb .st.err')!.textContent).toBe('Save failed: offline')
    studio.destroy()
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
