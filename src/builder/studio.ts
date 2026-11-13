// The builder UI (Studio) — written once against the DOM and wrapped by React
// and Vue (builder/react, builder/vue), so both builders behave identically.
// The canvas uses the client's own components (`renderPreview`): preview == client.

import { ActionSpec, ActionType, ComponentFactory, FIELD_PATTERNS, SduiNode, type SduiProps, type SduiValue } from '../core'
import { renderNodeDOM } from '../vanilla'
import { EditorDocument } from './document'
import { find, flatten, isGeneratedId, outlineLabel } from './tree'
import { findNodeJsonRange, renderPreview } from './preview'
import { STUDIO_CSS } from './studio-css'
import { diff, type ScreenChange } from './diff'

export interface StudioOptions {
  document?: EditorDocument
  factory?: ComponentFactory
  /// `adopt` (default): a constructable stylesheet — no inline `<style>`, so a strict CSP
  /// (`style-src 'self'`) holds. `external`: the app links `@fajekrina/sdui/builder/studio.css`.
  stylesheet?: 'adopt' | 'external'
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
  /// the app's catalog of names: offered by the action editor (screens, requests, links,
  /// commands) and the image `name` field (assets). An explicit `screens` / … option wins.
  catalog?: StudioCatalog
  /// view only (e.g. a reviewer role): no palette, no drag & drop, inspector and JSON
  /// disabled, no undo / import / save / publish / submit
  readOnly?: boolean
  /// the payload of the active release: the Studio lists what the draft changes against it
  baseline?: unknown
  /// maker-checker: hand the validated draft and a note to review instead of publishing
  onSubmitForReview?: (payload: unknown, note: string) => void | Promise<void>
  /// persist the validated payload (JSON object)
  onSave?: (payload: unknown) => void | Promise<void>
  onPublish?: (payload: unknown) => void | Promise<void>
  onChange?: (payload: unknown) => void
}

/// Options that may change after mounting (async lists, a new title, …).
export type StudioUpdate = Pick<StudioOptions, 'title' | 'screens' | 'requests' | 'links' | 'commands' | 'catalog' | 'readOnly' | 'baseline' | 'sampleData' | 'assetURL'>

export interface StudioCatalog {
  screens?: readonly string[]
  requests?: readonly string[]
  links?: readonly string[]
  commands?: readonly string[]
  /// image names the app's `assetURL` maps
  assets?: readonly string[]
}

export interface MountedStudio {
  readonly document: EditorDocument
  /// apply changed options (e.g. a screen list loaded after mounting) and repaint
  update(options: StudioUpdate): void
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

const CSS = STUDIO_CSS

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

  const opts: StudioOptions = { ...options }
  const detachStyles = attachStyles(target, CSS, opts.stylesheet)
  const root = el('div', { class: 'sdui-studio' })
  target.append(root)

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
  const LISTS = ['screens', 'requests', 'links', 'commands', 'assets'] as const
  const datalists = new Map(LISTS.map((name) => [name, el('datalist', { id: listId(name) })] as const))
  const namesOf = (name: typeof LISTS[number]): readonly string[] =>
    (name === 'assets' ? undefined : opts[name]) ?? opts.catalog?.[name] ?? []
  const fillLists = () => {
    for (const [name, list] of datalists) list.replaceChildren(...namesOf(name).map((v) => el('option', { value: v })))
  }
  root.append(...datalists.values())
  fillLists()

  // toolbar
  const keyInput = el('input', { 'aria-label': 'Screen key', class: 'key' }) as HTMLInputElement
  keyInput.addEventListener('change', () => doc.setKey(keyInput.value.trim()))
  const undo = button('↶ Undo', () => doc.undo())
  const redo = button('↷ Redo', () => doc.redo())
  const widthSel = el('select', { 'aria-label': 'Preview width', class: 'btn' }, el('option', { value: '375' }, 'Compact 375'), el('option', { value: '768' }, 'Wide 768')) as HTMLSelectElement
  widthSel.addEventListener('change', () => { width = Number(widthSel.value); paint() })
  const previewBtn = button('Preview', () => { previewMode = !previewMode; paint() })
  const statusEl = el('span', { class: 'st', role: 'status' })
  const titleEl = el('span', { class: 'ttl' })
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
  const importBtn = button('Import', () => {
    const text = globalThis.prompt?.('Paste a spec payload (or a legacy page) JSON')
    if (!text) return
    try { doc.importJSON(text); message = '' } catch (error) { message = String(error instanceof Error ? error.message : error) }
    paint()
  })
  const noteInput = el('input', { 'aria-label': 'Review note', placeholder: 'Note for the reviewer', class: 'note' }) as HTMLInputElement
  const submit = async () => {
    try {
      await opts.onSubmitForReview?.(JSON.parse(doc.exportJSON()), noteInput.value.trim())
      noteInput.value = ''
      showStatus('Submitted for review ✔', true)
    } catch (error) {
      showStatus(`Submit failed: ${error instanceof Error ? error.message : String(error)}`, false)
    }
    paint()
  }
  // hidden while read-only
  const editing: HTMLElement[] = [undo, redo, importBtn,
    ...(options.onSave ? [button('Save draft', () => void emit(options.onSave, 'Saved ✔', 'Save failed'))] : []),
    ...(options.onPublish ? [button('Publish', () => void emit(options.onPublish, 'Published ✔', 'Publish failed'), 'btn pri')] : []),
    ...(options.onSubmitForReview ? [noteInput, button('Submit for review', () => void submit(), 'btn pri')] : [])]
  const toolbar = el('div', { class: 'tb' },
    el('strong', {}, 'SDUI Studio'), titleEl,
    keyInput, undo, redo, widthSel, previewBtn, el('span', { class: 'sp' }), statusEl,
    importBtn,
    button('Export DSL', () => { void navigator.clipboard?.writeText(doc.exportDSL()); message = 'DSL copied to clipboard'; paint() }),
    ...editing.slice(3)
  )

  // drag & drop: palette → canvas/outline (insert), canvas/outline node → elsewhere (move)
  const startDrag = (event: DragEvent, next: Drag) => {
    if (opts.readOnly) { event.preventDefault(); return }
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
      const at = next && !previewMode && !opts.readOnly ? resolve(event) : undefined
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
      const at = next && !previewMode && !opts.readOnly ? resolve(event) : undefined
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
  const paletteBox = el('div', {}, el('h3', {}, 'Components'), el('div', { class: 'tip' }, 'Click to insert, or drag onto the canvas / outline.'), palette)
  const main = el('div', { class: 'main' },
    el('div', { class: 'col' }, paletteBox, el('h3', {}, 'Outline'), outline),
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
  // review: what the draft changes against the baseline (active release)
  const changesEl = el('div', { class: 'changes', 'aria-label': 'Changes against the active release' })
  const jsonPanel = el('div', { class: 'json' }, el('div', { class: 'hd' }, toggle, el('span', {}, 'JSON (2-way)'), badge), jsonBody, issues, changesEl)
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
      const input = el('input', { type: kind === 'number' ? 'number' : 'text', ...(node.type === 'image' && key === 'name' ? { list: listId('assets') } : {}) }) as HTMLInputElement
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
      if (id !== doc.root.id && !opts.readOnly) (element as HTMLElement).draggable = true
      element.setAttribute('title', `${node.type}${isGeneratedId(id) ? '' : ` #${id}`}`)
      if (id === doc.selection) element.setAttribute('data-label', element.getAttribute('title')!)
      if (doc.isContainer(id) && node.children.length === 0) element.append(el('div', { class: 'hint' }, `Empty ${node.type} — drop components here`))
    }
  }

  const paint = () => {
    keyInput.value = doc.key
    undo.disabled = !doc.canUndo
    redo.disabled = !doc.canRedo
    titleEl.textContent = opts.title ?? ''
    titleEl.style.display = opts.title ? '' : 'none'
    previewBtn.textContent = previewMode ? 'Edit' : 'Preview'
    previewBtn.className = previewMode ? 'btn on' : 'btn'
    previewBtn.setAttribute('aria-pressed', String(previewMode))
    main.classList.toggle('pv', previewMode)
    jsonPanel.style.display = previewMode ? 'none' : ''
    const readOnly = opts.readOnly === true
    root.classList.toggle('ro', readOnly)
    for (const control of editing) control.hidden = readOnly
    paletteBox.hidden = readOnly
    keyInput.disabled = readOnly
    jsonText.readOnly = readOnly
    statusEl.textContent = status?.text ?? ''
    statusEl.className = `st${status ? (status.ok ? ' ok' : ' err') : ''}`
    // outline
    outline.replaceChildren(...flatten(doc.root).map(([n, depth]) => {
      const row = el('div', { class: n.id === doc.selection ? 'row sel' : 'row', role: 'treeitem', 'data-sdui-row': n.id! }, outlineLabel(n))
      row.style.paddingLeft = `${8 + depth * 12}px`
      row.addEventListener('click', () => doc.select(n.id))
      if (n.id !== doc.root.id && !readOnly) {
        row.draggable = true
        row.addEventListener('dragstart', (event) => startDrag(event, { kind: 'node', id: n.id! }))
        row.addEventListener('dragend', endDrag)
      }
      return row
    }))
    // canvas
    device.style.width = `${width}px`
    const preview = renderPreview(factory, doc.root, { data: opts.sampleData, selected: previewMode ? undefined : doc.selection, assetURL: opts.assetURL })
    device.replaceChildren(...(preview ? [renderNodeDOM(preview, undefined, undefined, d)] : []))
    if (!previewMode) decorate()
    // inspector
    const selected = doc.selected
    if (selected) inspectorFor(selected)
    else inspector.replaceChildren(el('p', { class: 'empty' }, 'Select a node'))
    if (readOnly) for (const c of inspector.querySelectorAll('input, select, textarea, button')) (c as HTMLInputElement).disabled = true
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
    const payload = doc.payload().toJSON()
    paintChanges(opts.baseline === undefined ? undefined : diff(opts.baseline, payload))
    options.onChange?.(payload)
  }

  const paintChanges = (changes: ScreenChange[] | undefined) => {
    changesEl.hidden = changes === undefined
    if (!changes) return
    const show = (v: unknown) => { const s = v === undefined ? '∅' : JSON.stringify(v); return s.length > 40 ? `${s.slice(0, 39)}…` : s }
    changesEl.replaceChildren(
      el('div', { class: 'hd' }, changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} vs. the active release` : 'No changes vs. the active release'),
      ...changes.map((c) => el('div', { class: c.kind },
        `${c.kind} · ${c.type ?? 'screen'} ${c.path}${c.field ? ` · ${c.field}` : ''}${c.kind === 'changed' || c.kind === 'moved' ? `: ${show(c.before)} → ${show(c.after)}` : ''}`))
    )
  }

  const unsubscribe = doc.subscribe(paint)
  paint()

  return {
    document: doc,
    update(next) {
      Object.assign(opts, next)
      fillLists()
      paint()
    },
    destroy() {
      unsubscribe()
      clearTimeout(editTimer)
      clearTimeout(statusTimer)
      root.remove()
      detachStyles()
    }
  }
}

/// Install the stylesheet without an inline `<style>` (strict CSP): a constructable
/// stylesheet adopted by the target's document or shadow root. `external`: the app links
/// `@fajekrina/sdui/builder/studio.css` itself. Engines without constructable stylesheets
/// (Safari < 16.4) fall back to a `<style>` element, which a strict CSP would block.
function attachStyles(target: HTMLElement, css: string, mode: StudioOptions['stylesheet'] = 'adopt'): () => void {
  if (mode === 'external') return () => undefined
  const scope = target.getRootNode() as Document | ShadowRoot
  const Sheet = target.ownerDocument.defaultView?.CSSStyleSheet
  if (Sheet && 'adoptedStyleSheets' in scope && typeof Sheet.prototype.replaceSync === 'function') {
    const sheet = new Sheet()
    sheet.replaceSync(css)
    scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet]
    return () => { scope.adoptedStyleSheets = scope.adoptedStyleSheets.filter((x) => x !== sheet) }
  }
  const style = target.ownerDocument.createElement('style')
  style.textContent = css
  target.append(style)
  return () => style.remove()
}

export { find }
