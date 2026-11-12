// The builder UI (Studio) — written once against the DOM and wrapped by React
// and Vue (builder/react, builder/vue), so both builders behave identically.
// The canvas uses the client's own components (`renderPreview`): preview == client.

import { ActionSpec, ActionType, ComponentFactory, FIELD_PATTERNS, SduiNode, type SduiProps, type SduiValue } from '../core'
import { renderNodeDOM } from '../vanilla'
import { EditorDocument } from './document'
import { find, flatten, isGeneratedId, outlineLabel } from './tree'
import { findNodeJsonRange, renderPreview } from './preview'

export interface StudioOptions {
  document?: EditorDocument
  factory?: ComponentFactory
  /// sample data for `{{tokens}}` in the preview
  sampleData?: Record<string, SduiValue>
  assetURL?: (name: string) => string
  /// Names offered by the action editor — the app's allow-lists (screen keys,
  /// named requests, named links, host commands). Names only, never URLs; any
  /// other name can still be typed.
  screens?: readonly string[]
  requests?: readonly string[]
  links?: readonly string[]
  commands?: readonly string[]
  /// label shown in the toolbar, e.g. "merchant / home"
  title?: string
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
type Drag = { kind: 'type'; type: string } | { kind: 'node'; id: string }
type Zone = 'inside' | 'before' | 'after'
type RawAction = Record<string, unknown>

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

// action editor: the named target of each action type, and its picker list
const TARGETS: Record<string, [field: string, list: 'screens' | 'requests' | 'links' | 'commands']> = {
  navigate: ['screen', 'screens'], api: ['request', 'requests'], openURL: ['link', 'links'], native: ['command', 'commands']
}
const STARTERS: Record<string, RawAction> = {
  navigate: { type: 'navigate', screen: 'next' }, api: { type: 'api', request: 'myRequest' }, dismiss: { type: 'dismiss' },
  refresh: { type: 'refresh' }, openURL: { type: 'openURL', link: 'helpCenter' }, toast: { type: 'toast', message: 'Done', level: 'success' },
  native: { type: 'native', command: 'biometricConfirm' }
}
/// nested onSuccess/onError editors: 1 + 3 = the default `maxChainDepth` (4)
const MAX_NESTED = 3
const DRAG_MIME = 'application/x-sdui'

const CSS = `
.sdui-studio{display:flex;flex-direction:column;height:100%;min-height:560px;font:13px/1.4 system-ui,sans-serif;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.sdui-studio *{box-sizing:border-box}
.sdui-studio button,.sdui-studio select,.sdui-studio input,.sdui-studio textarea{font:inherit}
.sdui-studio .tb{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #e2e8f0;background:#fff;flex-wrap:wrap}
.sdui-studio .tb .sp{flex:1}
.sdui-studio .tb .ttl{font-size:12px;color:#64748b}
.sdui-studio .tb .st{font-size:12px}
.sdui-studio .tb .st.ok{color:#16a34a}
.sdui-studio .tb .st.err{color:#dc2626}
.sdui-studio .btn{height:28px;padding:0 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer}
.sdui-studio .btn:disabled{opacity:.4;cursor:default}
.sdui-studio .btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.sdui-studio .btn.on{background:#0f172a;border-color:#0f172a;color:#fff}
.sdui-studio .main{flex:1;display:grid;grid-template-columns:230px 1fr 290px;min-height:0}
.sdui-studio .main.pv{grid-template-columns:1fr}
.sdui-studio .main.pv>.col:not(.canvas){display:none}
.sdui-studio .col{display:flex;flex-direction:column;min-height:0;overflow:auto;border-right:1px solid #e2e8f0;background:#fff}
.sdui-studio .col h3{margin:0;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:1px solid #f1f5f9}
.sdui-studio .col .tip{padding:4px 10px 0;font-size:11px;color:#94a3b8}
.sdui-studio .pal{display:flex;flex-wrap:wrap;gap:4px;padding:8px}
.sdui-studio .pal button{border:1px solid #e2e8f0;background:#f8fafc;border-radius:4px;padding:2px 6px;cursor:grab}
.sdui-studio .row{display:flex;align-items:center;gap:4px;padding:3px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sdui-studio .row.sel{background:#dbeafe}
.sdui-studio .canvas{background:#f1f5f9;padding:16px;overflow:auto}
.sdui-studio .device{margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:12px;min-height:200px}
.sdui-studio .device .hint{padding:8px;border:1px dashed #cbd5e1;border-radius:6px;color:#94a3b8;font-size:12px;text-align:center}
.sdui-studio .device [data-label]{position:relative}
.sdui-studio .device [data-label]::after{content:attr(data-label);position:absolute;top:-18px;left:0;padding:0 6px;border-radius:4px;background:#2563eb;color:#fff;font:10px/16px system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:1}
.sdui-studio [data-drop="inside"]{box-shadow:inset 0 0 0 2px #22c55e!important}
.sdui-studio [data-drop="before"]{box-shadow:0 -3px 0 0 #22c55e!important}
.sdui-studio [data-drop="after"]{box-shadow:0 3px 0 0 #22c55e!important}
.sdui-studio .insp{padding:8px;display:flex;flex-direction:column;gap:8px}
.sdui-studio .insp label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#475569}
.sdui-studio .insp label.chk{flex-direction:row;align-items:center;gap:6px}
.sdui-studio .insp input,.sdui-studio .insp select,.sdui-studio .insp textarea{border:1px solid #cbd5e1;border-radius:4px;padding:4px 6px;background:#fff;color:#0f172a}
.sdui-studio .insp textarea{font-family:ui-monospace,monospace;font-size:11px;min-height:56px}
.sdui-studio .insp fieldset{border:1px solid #e2e8f0;border-radius:6px;display:flex;flex-direction:column;gap:6px;padding:8px}
.sdui-studio .insp details{border-left:2px solid #e2e8f0;padding-left:8px}
.sdui-studio .insp summary{cursor:pointer;font-size:12px;color:#475569}
.sdui-studio .insp .act{display:flex;flex-direction:column;gap:6px}
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
  const selectOf = (values: readonly string[], current: unknown, labelFor: (v: string) => string = (v) => v || '—') => {
    const select = el('select', {}, ...values.map((v) => el('option', { value: v }, labelFor(v)))) as HTMLSelectElement
    if (typeof current === 'string' && !values.includes(current)) select.append(el('option', { value: current }, current))
    select.value = typeof current === 'string' ? current : ''
    return select
  }

  const style = el('style', {}, CSS)
  const root = el('div', { class: 'sdui-studio' })
  target.append(style, root)

  let width = 375
  let jsonOpen = true
  let jsonEditing = false
  let previewMode = false
  let message = ''
  let status: { text: string; ok: boolean } | undefined
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  let drag: Drag | undefined

  // datalists for the action editor's named targets (one set per Studio)
  const uid = Math.random().toString(36).slice(2, 8)
  const listId = (name: string) => `sdui-${uid}-${name}`
  for (const name of ['screens', 'requests', 'links', 'commands'] as const) {
    root.append(el('datalist', { id: listId(name) }, ...(options[name] ?? []).map((v) => el('option', { value: v }))))
  }

  // toolbar
  const keyInput = el('input', { 'aria-label': 'Screen key', style: 'width:140px;height:28px;border:1px solid #cbd5e1;border-radius:6px;padding:0 6px' }) as HTMLInputElement
  keyInput.addEventListener('change', () => doc.setKey(keyInput.value.trim()))
  const undo = button('↶ Undo', () => doc.undo())
  const redo = button('↷ Redo', () => doc.redo())
  const widthSel = el('select', { 'aria-label': 'Preview width', class: 'btn' }, el('option', { value: '375' }, 'Compact 375'), el('option', { value: '768' }, 'Wide 768')) as HTMLSelectElement
  widthSel.addEventListener('change', () => { width = Number(widthSel.value); paint() })
  const previewBtn = button('Preview', () => { previewMode = !previewMode; paint() })
  const statusEl = el('span', { class: 'st', role: 'status' })
  const showStatus = (text: string, ok: boolean) => {
    status = { text, ok }
    clearTimeout(statusTimer)
    if (ok) statusTimer = setTimeout(() => { status = undefined; paint() }, 2500)
  }
  const emit = async (fn: StudioOptions['onSave'], done: string, failed: string) => {
    try {
      const json = JSON.parse(doc.exportJSON())
      await fn?.(json)
      showStatus(done, true)
    } catch (error) {
      showStatus(`${failed}: ${error instanceof Error ? error.message : String(error)}`, false)
    }
    paint()
  }
  const toolbar = el('div', { class: 'tb' },
    el('strong', {}, 'SDUI Studio'), ...(options.title ? [el('span', { class: 'ttl' }, options.title)] : []),
    keyInput, undo, redo, widthSel, previewBtn, el('span', { class: 'sp' }), statusEl,
    button('Import', () => {
      const text = globalThis.prompt?.('Paste a spec payload (or a legacy page) JSON')
      if (!text) return
      try { doc.importJSON(text); message = '' } catch (error) { message = String(error instanceof Error ? error.message : error) }
      paint()
    }),
    button('Export DSL', () => { void navigator.clipboard?.writeText(doc.exportDSL()); message = 'DSL copied to clipboard'; paint() }),
    ...(options.onSave ? [button('Save draft', () => void emit(options.onSave, 'Saved ✔', 'Save failed'))] : []),
    ...(options.onPublish ? [button('Publish', () => void emit(options.onPublish, 'Published ✔', 'Publish failed'), 'btn pri')] : [])
  )

  // drag & drop: palette → canvas/outline (insert), canvas/outline node → elsewhere (move)
  const startDrag = (event: DragEvent, next: Drag) => {
    drag = next
    try {
      event.dataTransfer?.setData(DRAG_MIME, JSON.stringify(next))
      event.dataTransfer?.setData('text/plain', next.kind === 'type' ? next.type : next.id)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'
    } catch { /* some engines restrict dataTransfer; the in-memory drag still works */ }
  }
  const currentDrag = (event: DragEvent): Drag | undefined => {
    if (drag) return drag
    try {
      const raw = event.dataTransfer?.getData(DRAG_MIME)
      return raw ? JSON.parse(raw) as Drag : undefined
    } catch {
      return undefined
    }
  }
  /// before / inside / after from the pointer position over `el`
  const zoneOf = (target: Element, event: DragEvent, id: string): Zone => {
    const rect = target.getBoundingClientRect()
    const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    if (doc.isContainer(id)) return id === doc.root.id || (y > 0.25 && y < 0.75) ? 'inside' : y <= 0.25 ? 'before' : 'after'
    return y < 0.5 ? 'before' : 'after'
  }
  let marked: Element | undefined
  const mark = (target: Element | undefined, zone?: Zone) => {
    if (marked && marked !== target) marked.removeAttribute('data-drop')
    marked = target
    if (target && zone) target.setAttribute('data-drop', zone)
  }
  const drop = (next: Drag, id: string, zone: Zone) => {
    const at = doc.placement(id, zone)
    if (!at) return
    if (next.kind === 'type') doc.add(next.type, at)
    else if (next.id !== id && doc.reparent(next.id, at.parentId, at.index)) doc.select(next.id)
  }
  /// wire a drop surface whose node elements carry the node id in `attr`
  const dropSurface = (surface: HTMLElement, attr: string, fallbackToRoot: boolean) => {
    const resolve = (event: DragEvent): [Element, string] | undefined => {
      const hit = (event.target as Element).closest?.(`[${attr}]`)
      if (hit && surface.contains(hit)) return [hit, hit.getAttribute(attr)!]
      return fallbackToRoot ? [surface, doc.root.id!] : undefined
    }
    surface.addEventListener('dragover', (event) => {
      const next = currentDrag(event)
      const at = next && !previewMode ? resolve(event) : undefined
      if (!at) return
      const zone = zoneOf(at[0], event, at[1])
      if (!doc.placement(at[1], zone) || (next!.kind === 'node' && next!.id === at[1])) { mark(undefined); return }
      event.preventDefault()
      mark(at[0], zone)
    })
    surface.addEventListener('dragleave', (event) => {
      if (!surface.contains(event.relatedTarget as Node | null)) mark(undefined)
    })
    surface.addEventListener('drop', (event) => {
      const next = currentDrag(event)
      const at = next && !previewMode ? resolve(event) : undefined
      mark(undefined)
      drag = undefined
      if (!at) return
      event.preventDefault()
      drop(next!, at[1], zoneOf(at[0], event, at[1]))
    })
  }
  const endDrag = () => { drag = undefined; mark(undefined) }

  // columns
  const palette = el('div', { class: 'pal' })
  for (const info of factory.palette()) {
    const item = button(info.type, () => doc.add(info.type), '')
    item.draggable = true
    item.addEventListener('dragstart', (event) => startDrag(event, { kind: 'type', type: info.type }))
    item.addEventListener('dragend', endDrag)
    palette.append(item)
  }
  const outline = el('div', { role: 'tree' })
  dropSurface(outline, 'data-sdui-row', false)
  const device = el('div', { class: 'device' })
  device.addEventListener('click', (event) => {
    if (previewMode) return
    const hit = (event.target as Element).closest?.('[data-sdui-node]')
    if (hit) doc.select(hit.getAttribute('data-sdui-node') ?? undefined)
  })
  device.addEventListener('dragstart', (event) => {
    const hit = (event.target as Element).closest?.('[data-sdui-node]')
    const id = hit?.getAttribute('data-sdui-node')
    if (id && id !== doc.root.id) startDrag(event, { kind: 'node', id })
  })
  device.addEventListener('dragend', endDrag)
  dropSurface(device, 'data-sdui-node', true)
  const inspector = el('div', { class: 'insp' })
  const main = el('div', { class: 'main' },
    el('div', { class: 'col' }, el('h3', {}, 'Components'), el('div', { class: 'tip' }, 'Click to insert, or drag onto the canvas / outline.'), palette, el('h3', {}, 'Outline'), outline),
    el('div', { class: 'col canvas' }, device),
    el('div', { class: 'col' }, el('h3', {}, 'Inspector'), inspector)
  )
  root.append(toolbar, main)

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

  /// A structured action editor: type, its named target (picked from the app's
  /// allow-list or typed), presentation / message / level, params, and the
  /// onSuccess / onError chain. Edits the raw JSON form; `commit` decodes it.
  const actionEditor = (raw: RawAction | undefined, commit: (next: RawAction | undefined) => void, depth: number): HTMLElement => {
    const box = el('div', { class: 'act' })
    const typeSel = selectOf(['', ...ActionType.allCases], raw?.type, (v) => v || '— none —')
    typeSel.addEventListener('change', () => commit(typeSel.value ? { ...STARTERS[typeSel.value] } : undefined))
    box.append(el('label', {}, 'type', typeSel))
    if (!raw) return box
    const set = (key: string, value: unknown) => {
      const next = { ...raw }
      if (value === undefined || value === '') delete next[key]
      else next[key] = value
      commit(next)
    }
    const type = String(raw.type)
    const textField = (key: string, list?: string) => {
      const input = el('input', list ? { list } : {}) as HTMLInputElement
      input.value = typeof raw[key] === 'string' ? raw[key] as string : ''
      input.addEventListener('change', () => set(key, input.value.trim()))
      return el('label', {}, key, input)
    }
    const target = TARGETS[type]
    if (target) box.append(textField(target[0], listId(target[1])))
    if (type === 'navigate') {
      const select = selectOf(['', 'push', 'sheet', 'fullScreen'], raw.presentation)
      select.addEventListener('change', () => set('presentation', select.value))
      box.append(el('label', {}, 'presentation', select))
    }
    if (type === 'toast') {
      box.append(textField('message'))
      const select = selectOf(['', 'info', 'success', 'warning', 'error'], raw.level)
      select.addEventListener('change', () => set('level', select.value))
      box.append(el('label', {}, 'level', select))
    }
    if (target) {
      const area = el('textarea', { 'aria-label': 'params' }) as HTMLTextAreaElement
      area.value = raw.params === undefined ? '' : JSON.stringify(raw.params)
      area.addEventListener('change', () => { try { set('params', area.value.trim() ? JSON.parse(area.value) : undefined) } catch { /* keep editing */ } })
      box.append(el('label', {}, 'params (JSON)', area))
    }
    if (depth < MAX_NESTED) {
      for (const key of ['onSuccess', 'onError'] as const) {
        const nested = raw[key] as RawAction | undefined
        const details = el('details', nested ? { open: '' } : {}, el('summary', {}, key), actionEditor(nested, (v) => set(key, v), depth + 1))
        box.append(details)
      }
    }
    return box
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
        const select = selectOf(Array.isArray(kind) ? kind : COLORS, current)
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

    // parent picker (moves the node to the end of another container)
    const placement: Node[] = []
    const candidates = doc.parentCandidates(id)
    if (candidates.length) {
      const parentId = flatten(doc.root).find(([n]) => n.children.some((c) => c.id === id))?.[0].id ?? ''
      const select = selectOf(candidates.map((c) => c.id!), parentId, (v) => {
        const n = find(doc.root, v)!
        return `${outlineLabel(n)}${isGeneratedId(v) ? '' : ` #${v}`}${v === doc.root.id ? ' (root)' : ''}`
      })
      select.addEventListener('change', () => { if (doc.reparent(id, select.value)) doc.select(id) })
      placement.push(el('label', {}, 'parent', select))
    }

    // action: structured editor + raw JSON for anything it does not cover
    const commitAction = (raw: RawAction | undefined) => {
      try {
        doc.setAction(id, raw ? ActionSpec.decode(raw) : undefined)
      } catch (error) {
        message = `Action: ${error instanceof Error ? error.message : String(error)}`
        paint()
      }
    }
    const actionJSON = el('textarea', { 'aria-label': 'Action JSON' }) as HTMLTextAreaElement
    actionJSON.value = node.action ? JSON.stringify(node.action.toJSON(), null, 1) : ''
    actionJSON.addEventListener('change', () => { try { commitAction(actionJSON.value ? JSON.parse(actionJSON.value) : undefined) } catch { /* keep editing */ } })

    const propsJSON = el('textarea', { 'aria-label': 'Props JSON' }) as HTMLTextAreaElement
    propsJSON.value = JSON.stringify(props)
    propsJSON.addEventListener('change', () => { try { doc.setProps(id, JSON.parse(propsJSON.value) as SduiProps) } catch { /* keep editing */ } })

    inspector.replaceChildren(
      el('fieldset', {}, el('legend', {}, `${node.type}${node.id && !isGeneratedId(node.id) ? ` #${node.id}` : ''}`), ...controls, ...placement),
      el('fieldset', {}, el('legend', {}, 'Action'),
        actionEditor(node.action?.toJSON(), commitAction, 0),
        el('details', {}, el('summary', {}, 'Action JSON'), actionJSON)),
      el('fieldset', {}, el('legend', {}, 'Props (JSON)'), propsJSON),
      el('div', { class: 'acts' },
        button('↑', () => doc.move(id, -1)), button('↓', () => doc.move(id, 1)),
        button('Duplicate', () => doc.duplicate(id)), button('Delete', () => doc.delete(id)))
    )
  }

  /// Edit-mode affordances on the rendered preview: draggable nodes, empty
  /// container hints, and a label on the selected node.
  const decorate = () => {
    const nodes = new Map(flatten(doc.root).map(([n]) => [n.id!, n]))
    for (const element of device.querySelectorAll('[data-sdui-node]')) {
      const id = element.getAttribute('data-sdui-node')!
      const node = nodes.get(id)
      if (!node) continue
      if (id !== doc.root.id) (element as HTMLElement).draggable = true
      element.setAttribute('title', `${node.type}${isGeneratedId(id) ? '' : ` #${id}`}`)
      if (id === doc.selection) element.setAttribute('data-label', element.getAttribute('title')!)
      if (doc.isContainer(id) && node.children.length === 0) element.append(el('div', { class: 'hint' }, `Empty ${node.type} — drop components here`))
    }
  }

  const paint = () => {
    keyInput.value = doc.key
    undo.disabled = !doc.canUndo
    redo.disabled = !doc.canRedo
    previewBtn.textContent = previewMode ? 'Edit' : 'Preview'
    previewBtn.className = previewMode ? 'btn on' : 'btn'
    previewBtn.setAttribute('aria-pressed', String(previewMode))
    main.classList.toggle('pv', previewMode)
    jsonPanel.style.display = previewMode ? 'none' : ''
    statusEl.textContent = status?.text ?? ''
    statusEl.className = `st${status ? (status.ok ? ' ok' : ' err') : ''}`
    // outline
    outline.replaceChildren(...flatten(doc.root).map(([n, depth]) => {
      const row = el('div', { class: n.id === doc.selection ? 'row sel' : 'row', style: `padding-left:${8 + depth * 12}px`, role: 'treeitem', 'data-sdui-row': n.id! }, outlineLabel(n))
      row.addEventListener('click', () => doc.select(n.id))
      if (n.id !== doc.root.id) {
        row.draggable = true
        row.addEventListener('dragstart', (event) => startDrag(event, { kind: 'node', id: n.id! }))
        row.addEventListener('dragend', endDrag)
      }
      return row
    }))
    // canvas
    device.style.width = `${width}px`
    const preview = renderPreview(factory, doc.root, { data: options.sampleData, selected: previewMode ? undefined : doc.selection, assetURL: options.assetURL })
    device.replaceChildren(...(preview ? [renderNodeDOM(preview, undefined, undefined, d)] : []))
    if (!previewMode) decorate()
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
      clearTimeout(statusTimer)
      root.remove()
      style.remove()
    }
  }
}

export { find }
