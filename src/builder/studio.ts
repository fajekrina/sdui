// The builder UI (Studio) — written once against the DOM and wrapped by React
// and Vue (builder/react, builder/vue), so both builders behave identically.
// The canvas uses the client's own components (`renderPreview`): preview == client.

import { ActionSpec, ActionType, ComponentFactory, FIELD_PATTERNS, SduiNode, type SduiProps, type SduiValue } from '../core'
import { renderNodeDOM } from '../vanilla'
import { EditorDocument } from './document'
import { find, flatten, outlineLabel } from './tree'
import { findNodeJsonRange, renderPreview } from './preview'

export interface StudioOptions {
  document?: EditorDocument
  factory?: ComponentFactory
  /// sample data for `{{tokens}}` in the preview
  sampleData?: Record<string, SduiValue>
  assetURL?: (name: string) => string
  /// persist the validated payload (JSON object)
  onSave?: (payload: unknown) => void | Promise<void>
  onPublish?: (payload: unknown) => void | Promise<void>
  onChange?: (payload: unknown) => void
}

export interface MountedStudio {
  readonly document: EditorDocument
  destroy(): void
}

type FieldKind = 'text' | 'number' | 'bool' | 'json' | string[]
const COLORS = ['', 'primary', 'onPrimary', 'secondary', 'surface', 'onSurface', 'background', 'muted', 'border', 'success', 'warning', 'danger']
const SHARED: Array<[string, FieldKind]> = [['padding', 'number'], ['background', 'text'], ['cornerRadius', 'number'], ['foreground', 'text'], ['a11yLabel', 'text'], ['a11yId', 'text']]
const FIELDS: Record<string, Array<[string, FieldKind]>> = {
  text: [['value', 'text'], ['style', ['', 'title', 'headline', 'body', 'caption']], ['weight', ['', 'regular', 'medium', 'semibold', 'bold', 'heavy']], ['size', 'number'], ['color', 'text']],
  image: [['systemName', 'text'], ['name', 'text'], ['contentMode', ['', 'fit', 'fill']], ['width', 'number'], ['height', 'number']],
  vstack: [['spacing', 'number'], ['alignment', ['', 'leading', 'center', 'trailing']]],
  hstack: [['spacing', 'number'], ['alignment', ['', 'top', 'center', 'bottom']]],
  zstack: [['width', 'number'], ['height', 'number']],
  button: [['title', 'text'], ['variant', ['', 'primary', 'secondary', 'plain']]],
  spacer: [['height', 'number'], ['width', 'number']],
  grid: [['columns', 'number'], ['spacing', 'number']],
  scroll: [['axis', ['', 'vertical', 'horizontal']], ['spacing', 'number']],
  list: [['items', 'text'], ['as', 'text'], ['spacing', 'number']],
  form: [['spacing', 'number']],
  textField: [['name', 'text'], ['label', 'text'], ['placeholder', 'text'], ['keyboard', ['', 'text', 'number', 'email', 'phone']], ['required', 'bool'], ['minLength', 'number'], ['maxLength', 'number'], ['pattern', ['', ...Object.keys(FIELD_PATTERNS)]], ['secure', 'bool']],
  textArea: [['name', 'text'], ['label', 'text'], ['placeholder', 'text'], ['rows', 'number'], ['required', 'bool'], ['maxLength', 'number']],
  picker: [['name', 'text'], ['label', 'text'], ['placeholder', 'text'], ['required', 'bool'], ['options', 'json']]
}

const CSS = `
.sdui-studio{display:flex;flex-direction:column;height:100%;min-height:560px;font:13px/1.4 system-ui,sans-serif;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.sdui-studio *{box-sizing:border-box}
.sdui-studio button,.sdui-studio select,.sdui-studio input,.sdui-studio textarea{font:inherit}
.sdui-studio .tb{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #e2e8f0;background:#fff;flex-wrap:wrap}
.sdui-studio .tb .sp{flex:1}
.sdui-studio .btn{height:28px;padding:0 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer}
.sdui-studio .btn:disabled{opacity:.4;cursor:default}
.sdui-studio .btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.sdui-studio .main{flex:1;display:grid;grid-template-columns:230px 1fr 290px;min-height:0}
.sdui-studio .col{display:flex;flex-direction:column;min-height:0;overflow:auto;border-right:1px solid #e2e8f0;background:#fff}
.sdui-studio .col h3{margin:0;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:1px solid #f1f5f9}
.sdui-studio .pal{display:flex;flex-wrap:wrap;gap:4px;padding:8px}
.sdui-studio .pal button{border:1px solid #e2e8f0;background:#f8fafc;border-radius:4px;padding:2px 6px;cursor:pointer}
.sdui-studio .row{display:flex;align-items:center;gap:4px;padding:3px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sdui-studio .row.sel{background:#dbeafe}
.sdui-studio .canvas{background:#f1f5f9;padding:16px;overflow:auto}
.sdui-studio .device{margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:12px;min-height:200px}
.sdui-studio .insp{padding:8px;display:flex;flex-direction:column;gap:8px}
.sdui-studio .insp label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#475569}
.sdui-studio .insp label.chk{flex-direction:row;align-items:center;gap:6px}
.sdui-studio .insp input,.sdui-studio .insp select,.sdui-studio .insp textarea{border:1px solid #cbd5e1;border-radius:4px;padding:4px 6px;background:#fff;color:#0f172a}
.sdui-studio .insp textarea{font-family:ui-monospace,monospace;font-size:11px;min-height:56px}
.sdui-studio .insp fieldset{border:1px solid #e2e8f0;border-radius:6px;display:flex;flex-direction:column;gap:6px;padding:8px}
.sdui-studio .insp .acts{display:flex;gap:4px;flex-wrap:wrap}
.sdui-studio .json{border-top:1px solid #e2e8f0;background:#0f172a;color:#e2e8f0;display:flex;flex-direction:column}
.sdui-studio .json .hd{display:flex;align-items:center;gap:8px;padding:4px 8px;background:#1e293b}
.sdui-studio .json .badge{font-size:11px;border:1px solid #60a5fa;border-radius:999px;padding:0 8px;color:#bfdbfe}
.sdui-studio .json .body{position:relative;height:220px;overflow:hidden}
.sdui-studio .json textarea{position:absolute;inset:0;width:100%;height:100%;background:transparent;color:#e2e8f0;border:0;padding:8px;font:12px/18px ui-monospace,monospace;white-space:pre;overflow:auto;resize:none;outline:none}
.sdui-studio .json .band{position:absolute;left:0;right:0;background:rgba(96,165,250,.16);border-left:3px solid #60a5fa;pointer-events:none}
.sdui-studio .issues{padding:4px 8px;font-size:12px;color:#fca5a5;background:#1e293b}
.sdui-studio .warn{color:#fcd34d}
`

/// Mount the Studio into an element.
export function mountStudio(target: HTMLElement, options: StudioOptions = {}): MountedStudio {
  const doc = options.document ?? new EditorDocument({ factory: options.factory })
  const factory = options.factory ?? doc.factory
  const d = target.ownerDocument
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>) => {
    const e = d.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    e.append(...kids)
    return e
  }
  const button = (label: string, onClick: () => void, cls = 'btn') => {
    const b = el('button', { type: 'button', class: cls }, label)
    b.addEventListener('click', onClick)
    return b
  }

  const style = el('style', {}, CSS)
  const root = el('div', { class: 'sdui-studio' })
  target.append(style, root)

  let width = 375
  let jsonOpen = true
  let jsonEditing = false
  let message = ''

  // toolbar
  const keyInput = el('input', { 'aria-label': 'Screen key', style: 'width:140px;height:28px;border:1px solid #cbd5e1;border-radius:6px;padding:0 6px' }) as HTMLInputElement
  keyInput.addEventListener('change', () => doc.setKey(keyInput.value.trim()))
  const undo = button('↶ Undo', () => doc.undo())
  const redo = button('↷ Redo', () => doc.redo())
  const widthSel = el('select', { 'aria-label': 'Preview width', class: 'btn' }, el('option', { value: '375' }, 'Compact 375'), el('option', { value: '768' }, 'Wide 768')) as HTMLSelectElement
  widthSel.addEventListener('change', () => { width = Number(widthSel.value); paint() })
  const emit = async (fn: StudioOptions['onSave']) => {
    try {
      const json = JSON.parse(doc.exportJSON())
      await fn?.(json)
      message = ''
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    paint()
  }
  const toolbar = el('div', { class: 'tb' },
    el('strong', {}, 'SDUI Studio'), keyInput, undo, redo, widthSel, el('span', { class: 'sp' }),
    button('Import', () => {
      const text = globalThis.prompt?.('Paste a spec payload (or a legacy page) JSON')
      if (!text) return
      try { doc.importJSON(text); message = '' } catch (error) { message = String(error instanceof Error ? error.message : error) }
      paint()
    }),
    button('Export DSL', () => { void navigator.clipboard?.writeText(doc.exportDSL()); message = 'DSL copied to clipboard' ; paint() }),
    ...(options.onSave ? [button('Save draft', () => void emit(options.onSave))] : []),
    ...(options.onPublish ? [button('Publish', () => void emit(options.onPublish), 'btn pri')] : [])
  )

  // columns
  const palette = el('div', { class: 'pal' })
  for (const info of factory.palette()) palette.append(button(info.type, () => doc.add(info.type), ''))
  const outline = el('div', {})
  const canvas = el('div', { class: 'canvas' })
  const device = el('div', { class: 'device' })
  canvas.append(device)
  device.addEventListener('click', (event) => {
    const hit = (event.target as Element).closest?.('[data-sdui-node]')
    if (hit) doc.select(hit.getAttribute('data-sdui-node') ?? undefined)
  })
  const inspector = el('div', { class: 'insp' })
  root.append(toolbar, el('div', { class: 'main' },
    el('div', { class: 'col' }, el('h3', {}, 'Components'), palette, el('h3', {}, 'Outline'), outline),
    el('div', { class: 'col canvas' }, device),
    el('div', { class: 'col' }, el('h3', {}, 'Inspector'), inspector)
  ))

  // JSON panel (collapsible; the selected node is highlighted and scrolled to)
  const LINE = 18
  const PAD = 8
  const jsonText = el('textarea', { spellcheck: 'false', wrap: 'off', 'aria-label': 'Payload JSON' }) as HTMLTextAreaElement
  const band = el('div', { class: 'band' })
  const jsonBody = el('div', { class: 'body' }, band, jsonText)
  const badge = el('span', { class: 'badge' })
  const toggle = button('▾', () => { jsonOpen = !jsonOpen; paint() })
  toggle.setAttribute('aria-expanded', 'true')
  const issues = el('div', { class: 'issues' })
  const jsonPanel = el('div', { class: 'json' }, el('div', { class: 'hd' }, toggle, el('span', {}, 'JSON (2-way)'), badge), jsonBody, issues)
  root.append(jsonPanel)
  let editTimer: ReturnType<typeof setTimeout> | undefined
  jsonText.addEventListener('input', () => {
    jsonEditing = true
    clearTimeout(editTimer)
    editTimer = setTimeout(() => {
      try { doc.importJSON(jsonText.value); message = '' } catch (error) { message = `JSON: ${error instanceof Error ? error.message : error}` }
      jsonEditing = false
      paint()
    }, 500)
  })
  jsonText.addEventListener('scroll', () => placeBand())
  const placeBand = () => {
    const range = findNodeJsonRange(jsonText.value, doc.selection)
    band.style.display = range ? 'block' : 'none'
    if (range) {
      band.style.top = `${PAD + range.startLine * LINE - jsonText.scrollTop}px`
      band.style.height = `${(range.endLine - range.startLine + 1) * LINE}px`
    }
    return range
  }

  const inspectorFor = (node: SduiNode) => {
    const id = node.id!
    const fields = [...(FIELDS[node.type] ?? []), ...SHARED]
    const props = node.props
    const controls = fields.map(([key, kind]) => {
      const current = props[key]
      if (kind === 'bool') {
        const input = el('input', { type: 'checkbox' }) as HTMLInputElement
        input.checked = current === true
        input.addEventListener('change', () => doc.setProp(id, key, input.checked || undefined))
        return el('label', { class: 'chk' }, input, key)
      }
      if (Array.isArray(kind) || key === 'background' || key === 'foreground' || key === 'color') {
        const opts = Array.isArray(kind) ? kind : COLORS
        const select = el('select', {}, ...opts.map((o) => el('option', { value: o }, o || '—'))) as HTMLSelectElement
        if (typeof current === 'string' && !opts.includes(current)) select.append(el('option', { value: current }, current))
        select.value = typeof current === 'string' ? current : ''
        select.addEventListener('change', () => doc.setProp(id, key, select.value || undefined))
        return el('label', {}, key, select)
      }
      if (kind === 'json') {
        const area = el('textarea', {}) as HTMLTextAreaElement
        area.value = current === undefined ? '' : JSON.stringify(current)
        area.addEventListener('change', () => { try { doc.setProp(id, key, area.value ? JSON.parse(area.value) : undefined) } catch { /* keep editing */ } })
        return el('label', {}, key, area)
      }
      const input = el('input', { type: kind === 'number' ? 'number' : 'text' }) as HTMLInputElement
      input.value = current === undefined || current === null ? '' : String(current)
      input.addEventListener('change', () => doc.setProp(id, key, input.value === '' ? undefined : kind === 'number' ? Number(input.value) : input.value))
      return el('label', {}, key, input)
    })

    // action editor
    const action = node.action
    const typeSel = el('select', {}, el('option', { value: '' }, '— none —'), ...ActionType.allCases.map((t) => el('option', { value: t }, t))) as HTMLSelectElement
    typeSel.value = action?.type ?? ''
    const actionJSON = el('textarea', { 'aria-label': 'Action JSON' }) as HTMLTextAreaElement
    actionJSON.value = action ? JSON.stringify(action.toJSON(), null, 1) : ''
    const setAction = (raw: unknown) => { try { doc.setAction(id, raw ? ActionSpec.decode(raw) : undefined) } catch { /* keep editing */ } }
    typeSel.addEventListener('change', () => {
      const t = typeSel.value
      const starter: Record<string, Record<string, unknown>> = {
        navigate: { type: 'navigate', screen: 'next' }, api: { type: 'api', request: 'myRequest' }, dismiss: { type: 'dismiss' },
        refresh: { type: 'refresh' }, openURL: { type: 'openURL', link: 'helpCenter' }, toast: { type: 'toast', message: 'Done', level: 'success' },
        native: { type: 'native', command: 'biometricConfirm' }
      }
      setAction(t ? starter[t] : undefined)
    })
    actionJSON.addEventListener('change', () => { try { setAction(actionJSON.value ? JSON.parse(actionJSON.value) : undefined) } catch { /* keep editing */ } })

    const propsJSON = el('textarea', { 'aria-label': 'Props JSON' }) as HTMLTextAreaElement
    propsJSON.value = JSON.stringify(props)
    propsJSON.addEventListener('change', () => { try { doc.setProps(id, JSON.parse(propsJSON.value) as SduiProps) } catch { /* keep editing */ } })

    inspector.replaceChildren(
      el('fieldset', {}, el('legend', {}, `${node.type}${node.id && !/^n_/.test(node.id) ? ` #${node.id}` : ''}`), ...controls),
      el('fieldset', {}, el('legend', {}, 'Action'), typeSel, actionJSON),
      el('fieldset', {}, el('legend', {}, 'Props (JSON)'), propsJSON),
      el('div', { class: 'acts' },
        button('↑', () => doc.move(id, -1)), button('↓', () => doc.move(id, 1)),
        button('Duplicate', () => doc.duplicate(id)), button('Delete', () => doc.delete(id)))
    )
  }

  const paint = () => {
    keyInput.value = doc.key
    undo.disabled = !doc.canUndo
    redo.disabled = !doc.canRedo
    // outline
    outline.replaceChildren(...flatten(doc.root).map(([n, depth]) => {
      const row = el('div', { class: n.id === doc.selection ? 'row sel' : 'row', style: `padding-left:${8 + depth * 12}px`, role: 'treeitem' }, outlineLabel(n))
      row.addEventListener('click', () => doc.select(n.id))
      return row
    }))
    // canvas
    device.style.width = `${width}px`
    const preview = renderPreview(factory, doc.root, { data: options.sampleData, selected: doc.selection, assetURL: options.assetURL })
    device.replaceChildren(...(preview ? [renderNodeDOM(preview, undefined, undefined, d)] : []))
    // inspector
    const selected = doc.selected
    if (selected) inspectorFor(selected)
    else inspector.replaceChildren(el('p', { style: 'color:#94a3b8;text-align:center' }, 'Select a node'))
    // JSON
    toggle.textContent = jsonOpen ? '▾' : '▸'
    toggle.setAttribute('aria-expanded', String(jsonOpen))
    jsonBody.style.display = jsonOpen ? 'block' : 'none'
    // the panel shows editor ids too, so the selected node can be located
    const withIds = JSON.stringify({ schemaVersion: '1.1', screen: { key: doc.key, root: doc.root.toJSON() } }, null, 2)
    if (!jsonEditing) jsonText.value = withIds
    const range = jsonOpen ? placeBand() : null
    badge.textContent = selected ? `${selected.type}${range ? ` · lines ${range.startLine + 1}–${range.endLine + 1}` : ''}` : ''
    badge.style.display = selected ? 'inline-block' : 'none'
    if (range && jsonOpen) {
      const top = PAD + range.startLine * LINE
      if (top < jsonText.scrollTop || top > jsonText.scrollTop + jsonText.clientHeight - LINE) jsonText.scrollTop = Math.max(0, top - LINE * 2)
      placeBand()
    }
    const problems = doc.issues().map((i) => i.message)
    issues.replaceChildren(
      ...[message, ...problems].filter(Boolean).map((m) => el('div', {}, `⚠ ${m}`)),
      ...doc.importWarnings.map((w) => el('div', { class: 'warn' }, `↳ ${w}`))
    )
    options.onChange?.(doc.payload().toJSON())
  }

  const unsubscribe = doc.subscribe(paint)
  paint()

  return {
    document: doc,
    destroy() {
      unsubscribe()
      clearTimeout(editTimer)
      root.remove()
      style.remove()
    }
  }
}

export { find }
