/**
 * @fajekrina/sdui — FajrinaBuilder (React)
 * 3-panel: palette | canvas (preview via <Fajrina>) | properties + JSON 2-way sync
 * Headless onSave — no hardcode /api/universal, consumer injects.
 * ponytail: native drag-drop, inline CSS only, no dnd lib
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Fajrina } from '../react/Fajrina'
import { normalizeToLayout, type FajrinaData, type UniversalComponent } from '../core/types'
import { buildLayoutStyle } from '../core/style'
import { createBuilderState, cssTextToStyle, styleToCssText } from './builder'

export interface FajrinaBuilderProps {
  data?: FajrinaData
  onChange?: (layout: { components: UniversalComponent[] }) => void
  onSave?: (payload: { components: UniversalComponent[] }) => Promise<void> | void
  onPublish?: (payload: { components: UniversalComponent[] }) => Promise<void> | void
  merchantId?: string
  pageKey?: string
  className?: string
  style?: React.CSSProperties
}

const PALETTE: { type: string, label: string }[] = [
  { type: 'Container', label: 'Container' },
  { type: 'Flex', label: 'Flex' },
  { type: 'Grid', label: 'Grid' },
  { type: 'Heading', label: 'Heading' },
  { type: 'Text', label: 'Text' },
  { type: 'Button', label: 'Button' },
  { type: 'Card', label: 'Card' },
  { type: 'Hero', label: 'Hero' },
  { type: 'Image', label: 'Image' },
  { type: 'Input', label: 'Input' },
  { type: 'Select', label: 'Select' },
  { type: 'Textarea', label: 'Textarea' },
  { type: 'Form', label: 'Form' },
  { type: 'Link', label: 'Link' },
  { type: 'Divider', label: 'Divider' },
  { type: 'Space', label: 'Space' },
]

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9aa3c7' }}><span>{label}</span>{children}</label>
}

export function FajrinaBuilder({ data, onChange, onSave, onPublish, merchantId, pageKey, className, style }: FajrinaBuilderProps) {
  const stateRef = useRef(createBuilderState(data))
  const [, bump] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(stateRef.current.toFlatArray(), null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  // sync external data once
  useEffect(() => {
    const l = normalizeToLayout(data ?? null)
    if (l?.components) {
      stateRef.current.fromLayout(l)
      setJsonText(JSON.stringify(stateRef.current.toFlatArray(), null, 2))
      setSelectedId(null)
      bump(x => x + 1)
    }
  }, []) // initial only

  const comps = stateRef.current.toFlatArray()
  const selected = comps.find(c => c.id === selectedId) ?? null

  const syncOut = (next: UniversalComponent[]) => {
    setJsonText(JSON.stringify(next, null, 2))
    onChange?.({ components: next })
    bump(x => x + 1)
  }

  const add = (type: string, parentId: string | null = null) => {
    const c = stateRef.current.add(type, parentId)
    setSelectedId(c.id)
    syncOut(stateRef.current.toFlatArray())
  }

  const patchSelected = (patch: Record<string, unknown>, stylePatch?: Record<string, string>) => {
    if (!selected) return
    const cur = selected
    const nextProps = patch ? { ...((cur.props ?? {}) as object), ...patch } : cur.props
    // handle style via css text separately
    const s = { ...stateRef.current.get().components.find(x => x.id === cur.id)! }
    s.props = nextProps as Record<string, unknown>
    if (stylePatch) s.style = { ...((s.style ?? {}) as object), ...stylePatch } as Record<string, string>
    stateRef.current.patch(cur.id, { props: nextProps as Record<string, unknown>, ...(stylePatch ? { style: s.style as Record<string, string> } : {}) })
    syncOut(stateRef.current.toFlatArray())
  }

  const onJsonEdit = (v: string) => {
    setJsonText(v)
    try {
      const parsed = JSON.parse(v)
      if (!Array.isArray(parsed)) throw new Error('Harus array')
      stateRef.current.setComponents(parsed)
      setJsonError(null)
      onChange?.({ components: parsed })
      bump(x => x + 1)
    } catch (e: unknown) { setJsonError((e as Error).message) }
  }

  const layoutData = useMemo(() => ({ layout: { components: comps } } as FajrinaData), [comps, jsonText])

  const doSave = async () => {
    try { await onSave?.({ components: comps }); setStatus('Saved ✔'); setTimeout(() => setStatus(''), 2000) } catch (e: unknown) { setStatus('Save failed: ' + (e as Error).message) }
  }
  const doPublish = async () => {
    try { await onPublish?.({ components: comps }); setStatus('Published ✔'); setTimeout(() => setStatus(''), 2000) } catch (e: unknown) { setStatus('Publish failed: ' + (e as Error).message) }
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1220', color: '#e6e9f5', ...style }}>
      <header style={{ height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', background: '#1a1f35', borderBottom: '1px solid #2c3354', flexShrink: 0 }}>
        <strong style={{ fontSize: 14 }}>Fajrina Builder</strong>
        {merchantId ? <span style={{ fontSize: 12, color: '#9aa3c7' }}>{merchantId}/{pageKey ?? ''}</span> : null}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: status.includes('failed') ? '#ff6b6b' : '#3ad29f' }}>{status}</span>
        <button onClick={doSave} style={btn('#3ad29f')}>Save</button>
        <button onClick={doPublish} style={btn('#f59e0b')}>Publish</button>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr 320px', overflow: 'hidden' }}>
        <aside style={{ background: '#1a1f35', borderRight: '1px solid #2c3354', overflow: 'auto', padding: 12 }}>
          <div style={{ fontSize: 11, color: '#9aa3c7', marginBottom: 8 }}>Drag ke canvas. Drop ke area kosong = root.</div>
          {PALETTE.map(p => (
            <div key={p.type} draggable onDragStart={e => e.dataTransfer.setData('text/plain', p.type)}
              style={{ padding: '8px 10px', border: '1px solid #2c3354', borderRadius: 8, background: '#0f1220', marginBottom: 6, cursor: 'grab', fontSize: 13 }}>
              {p.type}
            </div>
          ))}
        </aside>

        <div style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const t = e.dataTransfer.getData('text/plain'); if (t && (e.target as HTMLElement).id === 'fajrina-canvas-wrap') add(t, null) }}>
          <div id="fajrina-canvas-wrap" style={{ flex: 1, background: '#fff', color: '#0f172a', borderRadius: 12, border: '1px solid #e2e8f0', minHeight: 520, padding: 16, overflow: 'auto' }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const t = e.dataTransfer.getData('text/plain'); if (t) { e.stopPropagation(); add(t, null) } }}>
            {comps.length === 0
              ? <div style={{ border: '2px dashed #cbd5e1', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Canvas kosong — drag komponen dari palet kiri.</div>
              : <div onClick={e => { const id = (e.target as HTMLElement).closest('[data-fid]')?.getAttribute('data-fid'); if (id) setSelectedId(id) }}>
                {/* preview via Fajrina, tapi wrapper selectable */}
                <Fajrina data={layoutData} />
                {/* selectable overlay list */}
                <div style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
                  {comps.map(c => (
                    <div key={c.id} data-fid={c.id} onClick={() => setSelectedId(c.id)}
                      style={{ padding: '4px 8px', border: c.id === selectedId ? '1px solid #6c8cff' : '1px solid transparent', background: c.id === selectedId ? 'rgba(108,140,255,.08)' : 'transparent', borderRadius: 6, fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{c.type ?? c.component} • {c.id.slice(-6)} • order:{c.order ?? 0}</span>
                      <span style={{ color: '#94a3b8' }}>{c.parentId ? 'child' : 'root'}</span>
                    </div>
                  ))}
                </div>
              </div>}
          </div>
        </div>

        <aside style={{ background: '#1a1f35', borderLeft: '1px solid #2c3354', overflow: 'auto', padding: 12 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 8px 0' }}>Properties</h3>
          {!selected ? <div style={{ fontSize: 12, color: '#9aa3c7' }}>Pilih komponen di canvas</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="id"><input value={selected.id} disabled style={inp()} /></Field>
              <Field label="order"><input type="number" value={selected.order ?? 0} onChange={e => { const n = parseInt(e.target.value); stateRef.current.patch(selected.id, { order: isNaN(n) ? 0 : n } as unknown as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray()) }} style={inp()} /></Field>
              <Field label="parentId"><input value={selected.parentId ?? ''} placeholder="(root)" onChange={e => { stateRef.current.patch(selected.id, { parentId: e.target.value || null } as unknown as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray()) }} style={inp()} /></Field>
              {/* type-specific */}
              {String(selected.type ?? selected.component) === 'Heading' && <>
                <Field label="content"><input value={String((selected.props as Record<string,unknown>)?.content ?? '')} onChange={e => patchSelected({ content: e.target.value })} style={inp()} /></Field>
                <Field label="level"><select value={String((selected.props as Record<string,unknown>)?.level ?? 2)} onChange={e => patchSelected({ level: parseInt(e.target.value) })} style={inp()}>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
              </>}
              {String(selected.type ?? selected.component) === 'Text' && <Field label="content"><textarea value={String((selected.props as Record<string,unknown>)?.content ?? (selected.props as Record<string,unknown>)?.text ?? '')} onChange={e => patchSelected({ content: e.target.value })} style={{ ...inp(), minHeight: 60 }} /></Field>}
              {String(selected.type ?? selected.component) === 'Button' && <Field label="label"><input value={String((selected.props as Record<string,unknown>)?.label ?? '')} onChange={e => patchSelected({ label: e.target.value })} style={inp()} /></Field>}
              {['Input','Select','Textarea'].includes(String(selected.type ?? selected.component)) && <Field label="name"><input value={String((selected.props as Record<string,unknown>)?.name ?? '')} onChange={e => patchSelected({ name: e.target.value })} style={inp()} /></Field>}
              {String(selected.type ?? selected.component) === 'Image' && <>
                <Field label="src"><input value={String((selected.props as Record<string,unknown>)?.src ?? '')} onChange={e => patchSelected({ src: e.target.value })} style={inp()} /></Field>
                <Field label="alt"><input value={String((selected.props as Record<string,unknown>)?.alt ?? '')} onChange={e => patchSelected({ alt: e.target.value })} style={inp()} /></Field>
              </>}
              <Field label="props (JSON)"><textarea value={JSON.stringify(selected.props ?? {}, null, 2)} onChange={e => { try { const p = JSON.parse(e.target.value); stateRef.current.patch(selected.id, { props: p } as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray()) } catch {} }} style={{ ...inp(), minHeight: 80, fontFamily: 'monospace', fontSize: 11 }} /></Field>
              <Field label="Style (CSS)"><textarea value={styleToCssText(selected.style as Record<string,unknown>)} onChange={e => { const { style, error } = cssTextToStyle(e.target.value); if (!error) { stateRef.current.patch(selected.id, { style } as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray()) } }} style={{ ...inp(), minHeight: 80, fontFamily: 'monospace', fontSize: 11 }} placeholder={"background-color: #fff;\ncolor: #0f172a;"} /></Field>
              {(() => { const t = String(selected.type ?? ''); const p = (selected.props ?? {}) as Record<string,unknown>; const cur: Record<string,string> = (selected.style ?? {}) as Record<string,string>; const preview = buildLayoutStyle(t, p, cur); return <div style={{ fontSize: 11, color: '#9aa3c7', border: '1px solid #2c3354', borderRadius: 6, padding: 8 }}><div style={{ fontWeight: 600, marginBottom: 4 }}>Style preview (buildLayoutStyle)</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 10 }}>{JSON.stringify(preview, null, 2)}</pre></div> })()}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { stateRef.current.duplicate(selected.id); syncOut(stateRef.current.toFlatArray()); setSelectedId(stateRef.current.get().selectedId) }} style={{ ...btn('#2c3354'), flex: 1 }}>Duplicate</button>
                <button onClick={() => { stateRef.current.remove(selected.id); setSelectedId(null); syncOut(stateRef.current.toFlatArray()) }} style={{ ...btn('#ff6b6b'), flex: 1 }}>Delete</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div style={{ height: 220, background: '#1a1f35', borderTop: '1px solid #2c3354', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#232a45', borderBottom: '1px solid #2c3354' }}>
          <span style={{ fontSize: 12, color: '#9aa3c7' }}>JSON — flat array (2-way sync)</span>
          <button onClick={() => { try { setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2)) } catch {} }} style={{ marginLeft: 'auto', ...btn('#0f1220'), fontSize: 11, padding: '4px 8px' }}>Format</button>
        </div>
        <textarea value={jsonText} onChange={e => onJsonEdit(e.target.value)} spellCheck={false}
          style={{ flex: 1, background: '#0f1220', color: '#e6e9f5', border: 0, padding: 10, fontFamily: 'monospace', fontSize: 12, resize: 'none', outline: 'none' }} />
        {jsonError && <div style={{ fontSize: 11, color: '#ff6b6b', padding: '4px 8px' }}>{jsonError}</div>}
      </div>
    </div>
  )
}

function btn(bg: string): React.CSSProperties {
  return { height: 28, padding: '0 12px', borderRadius: 6, border: `1px solid ${bg}`, background: bg, color: bg === '#0f1220' || bg === '#2c3354' ? '#e6e9f5' : '#fff', cursor: 'pointer', fontSize: 13 }
}
function inp(): React.CSSProperties {
  return { width: '100%', background: '#0f1220', border: '1px solid #2c3354', color: '#e6e9f5', borderRadius: 6, padding: '6px 8px', fontSize: 12 }
}

export default FajrinaBuilder
