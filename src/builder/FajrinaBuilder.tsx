/**
 * @fajekrina/sdui — FajrinaBuilder (React)
 * Sync registry dari consumer prop `registry` (components saja), keep netral putih, drag ke Container/Form
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Fajrina } from '../react/Fajrina'
import { normalizeToLayout, getComponentType, type FajrinaData, type UniversalComponent } from '../core/types'
import { buildLayoutStyle } from '../core/style'
import { buildTree } from '../core/tree'
import { createBuilderState, cssTextToStyle, styleToCssText, genId } from './builder'

export type RegistryComponents = Record<string, { props?: Record<string, unknown> }>

export interface FajrinaBuilderProps {
  data?: FajrinaData
  registry?: RegistryComponents
  pages?: string[]
  modals?: { id: string }[]
  onChange?: (layout: { components: UniversalComponent[] }) => void
  onSave?: (payload: { components: UniversalComponent[] }) => Promise<void> | void
  onPublish?: (payload: { components: UniversalComponent[] }) => Promise<void> | void
  merchantId?: string
  pageKey?: string
  className?: string
  style?: React.CSSProperties
}

const FALLBACK_ORDER = ['Container','Heading','Text','Button','Image','Input','Select','Textarea','Form','Link','Flex','Grid','Card','Hero','Divider','Space','Modal']

function paletteOrder(reg?: RegistryComponents): string[] {
  const keys = reg ? Object.keys(reg) : FALLBACK_ORDER
  const ordered = FALLBACK_ORDER.filter(k => keys.includes(k))
  const rest = keys.filter(k => !ordered.includes(k))
  return [...ordered, ...rest]
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9aa3c7' }}><span>{label}</span>{children}</label>
}
function dotColor(type: string) {
  if (type==='Container') return '#6c8cff'
  if (type==='Heading') return '#f59e0b'
  if (type==='Button') return '#3ad29f'
  if (type==='Modal') return '#f472b6'
  if (['Input','Select','Textarea','Form'].includes(type)) return '#a78bfa'
  return '#232a45'
}

export function FajrinaBuilder({ data, registry, pages, modals, onChange, onSave, onPublish, merchantId, pageKey, className, style }: FajrinaBuilderProps) {
  const stateRef = useRef(createBuilderState(data))
  const [, bump] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(stateRef.current.toFlatArray(), null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const lastEmittedRef = useRef<string | null>(null)

  useEffect(() => {
    const l = normalizeToLayout(data ?? null)
    if (!l?.components) return
    const incomingKey = l.components.map(c=>c.id).sort().join(',')
    if (lastEmittedRef.current && incomingKey === lastEmittedRef.current) return
    stateRef.current.fromLayout(l)
    setJsonText(JSON.stringify(stateRef.current.toFlatArray(), null, 2))
    // keep selection if still exists
    const stillExists = l.components.some(c=>c.id===selectedId)
    if (!stillExists) setSelectedId(null)
    bump(x=>x+1)
  }, [data])

  const comps = stateRef.current.toFlatArray()
  const selected = comps.find(c => c.id === selectedId) ?? null
  const palette = useMemo(() => paletteOrder(registry), [registry])
  const tree = useMemo(() => buildTree(comps), [comps, jsonText])
  const internalModals = useMemo(()=> comps.filter(c=>getComponentType(c as UniversalComponent)==='Modal').map(c=>({id:c.id})), [comps, jsonText])
  const effectivePages = pages ?? ['home']
  const effectiveModals = (modals && modals.length ? modals : internalModals) as {id:string}[]

  const syncOut = (next: UniversalComponent[]) => {
    lastEmittedRef.current = next.map(c=>c.id).sort().join(',')
    setJsonText(JSON.stringify(next, null, 2))
    onChange?.({ components: next })
    bump(x=>x+1)
  }

  const add = (type: string, parentId: string | null = null) => {
    // defaults dari registry props
    const def = registry?.[type]?.props as Record<string, unknown> | undefined
    const defaults: Record<string, unknown> = {}
    if (def) {
      for (const [k, v] of Object.entries(def)) {
        if (Array.isArray(v) && v.length) defaults[k]=v[0]
        else if (typeof v === 'object' && v !== null && 'default' in (v as Record<string,unknown>)) defaults[k]=(v as Record<string,unknown>).default
        else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') defaults[k]=v
      }
    }
    // type-specific minimal
    if (type==='Heading' && !defaults.content) defaults.content='Heading'
    if (type==='Text' && !defaults.content) defaults.content='Text'
    if (type==='Button' && !defaults.label) defaults.label='Button'
    if (type==='Image' && !defaults.src) defaults.src='https://picsum.photos/400/200'
    if ((type==='Input'||type==='Select'||type==='Textarea') && !defaults.name) defaults.name=type.toLowerCase() + '_' + Math.random().toString(36).slice(2,5)
    const added = stateRef.current.add(type, parentId)
    stateRef.current.patch(added.id, { props: defaults } as Partial<UniversalComponent>)
    stateRef.current.patch(added.id, { type: type as never, component: type as never } as Partial<UniversalComponent>)
    // remove the extra added without defaults and replace? Actually add already added one, we patched it. But we created comp not used. Use patch on added.
    setSelectedId(added.id)
    syncOut(stateRef.current.toFlatArray())
  }

  const patchSelected = (patch: Record<string, unknown>) => {
    if (!selected) return
    const merged = { ...((selected.props ?? {}) as object), ...patch }
    stateRef.current.patch(selected.id, { props: merged as Record<string, unknown> })
    syncOut(stateRef.current.toFlatArray())
  }

  const updateAction = (behavior: string, extra: Record<string, unknown> = {}) => {
    if (!selected) return
    const curPropsA = ((selected.props as Record<string, unknown>)?.action as Record<string, unknown> ?? {}) as Record<string, unknown>
    const curTopA = ((selected as UniversalComponent).action as Record<string, unknown> ?? {}) as Record<string, unknown>
    const base: Record<string, unknown> = { ...curPropsA, ...curTopA, behavior, ...extra }
    // cleanup per behavior
    const keep: Record<string, string[]> = {
      navigate: ['behavior','target','params'],
      submit: ['behavior','target','modalId','params'],
      externalLink: ['behavior','href','target'],
      openModal: ['behavior','modalId','title','message'],
      closeModal: ['behavior','modalId'],
      toast: ['behavior','message'],
      customEvent: ['behavior','eventName','params'],
      back: ['behavior'],
    }
    const allowed = keep[behavior] ?? ['behavior','target','href','modalId','message','eventName','params']
    for (const k of Object.keys(base)) if (!allowed.includes(k)) delete base[k]
    const { behavior: _b, target: _t, href: _h, modalId: _m, message: _msg, eventName: _e, params: _p, action: _a, ...restProps } = selected.props as Record<string, unknown>
    stateRef.current.patch(selected.id, { props: { ...restProps, action: base } as Record<string, unknown>, action: base as unknown as UniversalComponent['action'] })
    syncOut(stateRef.current.toFlatArray())
  }

  const onJsonEdit = (v: string) => {
    setJsonText(v)
    try {
      const parsed = JSON.parse(v)
      if (!Array.isArray(parsed)) throw new Error('Harus array')
      parsed.forEach((c: Record<string,unknown>, i:number)=>{ if(!c.id || (!c.type && !c.component)) throw new Error(`Item ${i} missing id/type`); if(!('order' in c)) throw new Error(`Item ${i} missing order`) })
      lastEmittedRef.current = parsed.map((c: Record<string,unknown>)=> String(c.id)).sort().join(',')
      stateRef.current.setComponents(parsed)
      setJsonError(null); onChange?.({ components: parsed }); bump(x=>x+1)
    } catch (e: unknown) { setJsonError((e as Error).message) }
  }

  const layoutData = useMemo(() => ({ layout: { components: comps } } as FajrinaData), [comps, jsonText])

  const doSave = async () => { try{ await onSave?.({ components: comps }); setStatus('Saved ✔'); setTimeout(()=>setStatus(''),2500)}catch(e:unknown){ setStatus('Save failed: '+(e as Error).message)} }
  const doPublish = async () => { try{ await onPublish?.({ components: comps }); setStatus('Published ✔'); setTimeout(()=>setStatus(''),2500)}catch(e:unknown){ setStatus('Publish failed: '+(e as Error).message)} }

  // render tree node with drop-hint for Container/Form/Modal/Grid/Flex
  function renderNode(node: UniversalComponent & {children: UniversalComponent[]}) {
    const t = getComponentType(node)
    const isContainer = ['Container','Form','Modal','Grid','Flex','Card','Hero'].includes(t)
    const isSelected = node.id===selectedId
    const isDragOver = dragOverId===node.id
    const style: React.CSSProperties = { position:'relative', border: isSelected ? '1px solid #6c8cff' : '1px solid transparent', borderRadius:8, padding:4, background: isSelected ? 'rgba(108,140,255,.06)' : 'transparent', outline: isDragOver ? '2px dashed #6c8cff' : undefined, outlineOffset: -2 }
    if (isContainer) style.border='1px dashed #cbd5e1'; // container-box
    const header = <div style={{ fontSize:11, color:'#64748b', display:'flex', justifyContent:'space-between' }}><span>{t} • {node.id.slice(-6)} • order:{node.order}</span><span style={{fontSize:10}}>{node.parentId?'child':'root'}</span></div>
    const inner = (node.children ?? []).map((ch: UniversalComponent)=> renderNode(ch as never))
    const dropProps = isContainer ? {
      onDragOver: (e: React.DragEvent)=>{ e.preventDefault(); e.stopPropagation(); setDragOverId(node.id) },
      onDragLeave: ()=> setDragOverId(null),
      onDrop: (e: React.DragEvent)=>{ e.preventDefault(); e.stopPropagation(); setDragOverId(null); const ty=e.dataTransfer.getData('text/plain'); if(ty) add(ty, node.id) }
    } : {}

    // leaf preview — keep neutral putih, support all 16 types
    const leafStyle = buildLayoutStyle(t, (node.props ?? {}) as Record<string,unknown>, (node.style ?? {}) as Record<string,string>) as React.CSSProperties
    let preview: React.ReactNode = null
    if (t==='Heading') { const lvl=Math.min(6,Math.max(1,parseInt(String((node.props as Record<string,unknown>)?.level ?? 2)))); const Tag=`h${lvl}` as never; preview = React.createElement(Tag as string, {style: leafStyle}, String((node.props as Record<string,unknown>)?.content ?? '')) }
    else if (t==='Text') preview = <p style={leafStyle}>{String((node.props as Record<string,unknown>)?.content ?? (node.props as Record<string,unknown>)?.text ?? '')}</p>
    else if (t==='Button') preview = <button type="button" style={leafStyle as React.CSSProperties}>{String((node.props as Record<string,unknown>)?.label ?? 'Button')}</button>
    else if (t==='Image') preview = <img src={String((node.props as Record<string,unknown>)?.src ?? '')} alt="" style={{...leafStyle, maxHeight:320, maxWidth:'100%'} as React.CSSProperties} />
    else if (t==='Input') { const p=node.props as Record<string,unknown>; preview = <label style={{display:'block', fontSize:12}}><span style={{color:'#374151', fontSize:11}}>{String(p.label ?? p.name ?? 'Input')}{p.required ? ' *':''}</span><input placeholder={String(p.placeholder ?? '')} style={leafStyle} disabled /></label> }
    else if (t==='Select') { const p=node.props as Record<string,unknown>; const opts=(p.options as unknown[] ?? []); preview = <label style={{display:'block', fontSize:12}}><span style={{color:'#374151', fontSize:11}}>{String(p.label ?? p.name ?? 'Select')}{p.required ? ' *':''}</span><select style={leafStyle} disabled><option>{String(p.placeholder ?? 'Select')}</option>{opts.map((o: unknown)=>{const v=typeof o==='string'?o:String((o as Record<string,unknown>).value??''); const l=typeof o==='string'?o:String((o as Record<string,unknown>).label??v); return <option key={v} value={v}>{l}</option>})}</select></label> }
    else if (t==='Textarea') { const p=node.props as Record<string,unknown>; preview = <label style={{display:'block', fontSize:12}}><span style={{color:'#374151', fontSize:11}}>{String(p.label ?? p.name ?? 'Textarea')}{p.required ? ' *':''}</span><textarea placeholder={String(p.placeholder ?? '')} rows={Number(p.rows ?? 3)} style={leafStyle} disabled /></label> }
    else if (t==='Link') { const p=node.props as Record<string,unknown>; preview = <a href={String(p.href ?? '#')} style={leafStyle}>{String(p.label ?? p.text ?? 'Link')}</a> }
    else if (t==='Space') preview = <div style={{...leafStyle, background:'#e2e8f0', border:'1px dashed #cbd5e1'}} />
    else if (t==='Divider') preview = <div style={leafStyle} />
    else if (['Flex','Grid'].includes(t)) preview = <div style={leafStyle}>{inner.length? inner : <div style={{fontSize:12, color:'#94a3b8', padding:8, textAlign:'center', border:'1px dashed #cbd5e1', borderRadius:6}}>Empty {t} — drop here</div>}</div>
    else if (['Card','Hero'].includes(t)) preview = <div style={leafStyle}><div style={{fontSize:13, fontWeight:600}}>{String((node.props as Record<string,unknown>)?.title ?? t)}</div>{inner.length? <div style={{marginTop:8}}>{inner}</div> : <div style={{fontSize:12,color:'#64748b'}}>{String((node.props as Record<string,unknown>)?.description ?? '')}</div>}</div>
    else if (isContainer) preview = <div style={leafStyle}>{inner.length? inner : <div style={{fontSize:12, color:'#94a3b8', padding:8, textAlign:'center', border:'1px dashed #cbd5e1', borderRadius:6}}>Empty {t} — drop here</div>}</div>
    else preview = <div style={{fontSize:12, color:'#b45309'}}>Unsupported {t}</div>

    return <div key={node.id} data-fid={node.id} draggable={false} style={style} onClick={e=>{ e.stopPropagation(); setSelectedId(node.id)}} {...dropProps}><div onClick={e=>{ e.stopPropagation(); setSelectedId(node.id)}}>{header}{preview}</div>{!isContainer && inner.length ? <div style={{marginTop:4}}>{inner}</div> : null}</div>
  }

  return (
    <div className={className} style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#0f1220', color:'#e6e9f5', ...style }}>
      <header style={{ height:52, display:'flex', alignItems:'center', gap:8, padding:'0 12px', background:'#1a1f35', borderBottom:'1px solid #2c3354', flexShrink:0 }}>
        <strong style={{ fontSize:14 }}>Fajrina Builder</strong>
        {merchantId ? <span style={{ fontSize:12, color:'#9aa3c7' }}>{merchantId}/{pageKey ?? ''}</span> : null}
        <span style={{ marginLeft:'auto', fontSize:12, color: status.includes('failed')?'#ff6b6b':'#3ad29f'}}>{status}</span>
        <button onClick={doSave} style={btn('#3ad29f')}>Save</button>
        <button onClick={doPublish} style={btn('#f59e0b')}>Publish</button>
      </header>

      <div style={{ flex:1, display:'grid', gridTemplateColumns:'260px 1fr 340px', overflow:'hidden' }}>
        <aside style={{ background:'#1a1f35', borderRight:'1px solid #2c3354', overflow:'auto', padding:12 }}>
          <h2 style={{ fontSize:12, letterSpacing:'.08em', color:'#9aa3c7', margin:'8px 0 6px', textTransform:'uppercase' as const}}>Palette</h2>
          <div style={{ fontSize:11, color:'#9aa3c7', marginBottom:8 }}>Drag ke canvas. Drop ke Container untuk jadi child.</div>
          {palette.map(t=>{
            const def = registry?.[t]
            const keys = def?.props ? Object.keys(def.props).slice(0,3).join(', ') : ''
            return <div key={t} draggable onDragStart={e=>e.dataTransfer.setData('text/plain', t)} style={{ padding:'10px', border:'1px solid #2c3354', borderRadius:8, background:'#0f1220', marginBottom:8, cursor:'grab', display:'flex', alignItems:'center', gap:8, fontSize:13}}>
              <span style={{ width:22, height:22, borderRadius:6, background:dotColor(t), display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff'}}>{t[0]}</span>
              <span>{t}</span><small style={{ color:'#9aa3c7', fontSize:11, marginLeft:'auto'}}>{keys}</small>
            </div>
          })}
        </aside>

        <div style={{ overflow:'auto', padding:16, display:'flex', flexDirection:'column', gap:12 }}>
          <div id="fajrina-canvas-wrap" style={{ flex:1, background:'#fff', color:'#0f172a', borderRadius:12, border:'1px solid #e2e8f0', minHeight:520, padding:24, overflow:'auto'}} onDragOver={e=>e.preventDefault()} onDrop={e=>{ e.preventDefault(); e.stopPropagation(); const t=e.dataTransfer.getData('text/plain'); if(t) add(t,null)}} onClick={()=>setSelectedId(null)}>
            {comps.length===0 ? <div style={{ border:'2px dashed #cbd5e1', borderRadius:10, padding:40, textAlign:'center', color:'#64748b', fontSize:13}}>Canvas kosong — drag komponen dari palet kiri ke sini.<br/>Drop ke area kosong = root, drop ke Container/Form = child.</div> : tree.map(n=>renderNode(n as never))}
          </div>
          {/* hidden Fajrina preview for validation (keep neutral) */}
          <div style={{ display:'none'}}><Fajrina data={layoutData} /></div>
        </div>

        <aside style={{ background:'#1a1f35', borderLeft:'1px solid #2c3354', overflow:'auto', padding:12 }}>
          <h2 style={{ fontSize:13, margin:'0 0 8px 0'}}>Properties</h2>
          {!selected ? <div style={{ fontSize:12, color:'#9aa3c7'}}>Pilih komponen di canvas</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:10}}>
              <div style={{ border:'1px solid #2c3354', borderRadius:8, overflow:'hidden'}}>
                <h3 style={{ fontSize:11, letterSpacing:'.06em', color:'#9aa3c7', background:'#232a45', padding:'6px 8px', textTransform:'uppercase' as const}}>Identity</h3>
                <div style={{ padding:8, display:'flex', flexDirection:'column', gap:8}}>
                  <Field label="id"><input value={selected.id} disabled style={inp()} /></Field>
                  <Field label="order"><input type="number" value={selected.order ?? 0} onChange={e=>{ const n=parseInt(e.target.value); stateRef.current.patch(selected.id, {order:isNaN(n)?0:n} as unknown as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray())}} style={inp()} /></Field>
                  <Field label="parentId"><select value={selected.parentId ?? ''} onChange={e=>{ stateRef.current.patch(selected.id, {parentId:e.target.value||null} as unknown as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray())}} style={inp()}><option value="">(root)</option>{comps.filter(c=>c.id!==selected.id && ['Container','Form'].includes(getComponentType(c))).map(c=> <option key={c.id} value={c.id}>{getComponentType(c)} • {c.id.slice(-6)}</option>)}</select></Field>
                </div>
              </div>

              <div style={{ border:'1px solid #2c3354', borderRadius:8, overflow:'hidden'}}>
                <h3 style={{ fontSize:11, letterSpacing:'.06em', color:'#9aa3c7', background:'#232a45', padding:'6px 8px', textTransform:'uppercase' as const}}>Props</h3>
                <div style={{ padding:8, display:'flex', flexDirection:'column', gap:8}}>
                  {String(getComponentType(selected))==='Heading' && <>
                    <Field label="content"><input value={String((selected.props as Record<string,unknown>)?.content ?? '')} onChange={e=>patchSelected({content:e.target.value})} style={inp()} /></Field>
                    <Field label="level"><select value={String((selected.props as Record<string,unknown>)?.level ?? 2)} onChange={e=>patchSelected({level:parseInt(e.target.value)})} style={inp()}>{[1,2,3,4,5,6].map(n=> <option key={n} value={n}>{n}</option>)}</select></Field>
                  </>}
                  {String(getComponentType(selected))==='Text' && <>
                    <Field label="content"><textarea value={String((selected.props as Record<string,unknown>)?.content ?? (selected.props as Record<string,unknown>)?.text ?? '')} onChange={e=>patchSelected({content:e.target.value})} style={{...inp(), minHeight:60}} /></Field>
                    <Field label="tag"><select value={String((selected.props as Record<string,unknown>)?.tag ?? 'p')} onChange={e=>patchSelected({tag:e.target.value})} style={inp()}><option>p</option><option>span</option><option>label</option></select></Field>
                  </>}
                  {String(getComponentType(selected))==='Button' && <>
                    <Field label="label"><input value={String((selected.props as Record<string,unknown>)?.label ?? '')} onChange={e=>patchSelected({label:e.target.value})} style={inp()} /></Field>
                    <Field label="type"><select value={String((selected.props as Record<string,unknown>)?.type ?? 'button')} onChange={e=>patchSelected({type:e.target.value})} style={inp()}><option>button</option><option>submit</option><option>reset</option></select></Field>
                    <Field label="disabled"><select value={String(Boolean((selected.props as Record<string,unknown>)?.disabled))} onChange={e=>patchSelected({disabled:e.target.value==='true'})} style={inp()}><option value="false">false</option><option value="true">true</option></select></Field>
                    <Field label="action.behavior"><select value={String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as UniversalComponent).action?.behavior ?? 'navigate')} onChange={e=>updateAction(e.target.value)} style={inp()}><option>navigate</option><option>submit</option><option>externalLink</option><option>back</option><option>openModal</option><option>closeModal</option><option>toast</option><option>customEvent</option></select></Field>
                    {(() => { const beh = String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as UniversalComponent).action?.behavior ?? 'navigate'); const act = (((selected.props as Record<string,unknown>)?.action as Record<string,unknown>) ?? (selected as UniversalComponent).action as Record<string,unknown> ?? {}) as Record<string,unknown>; const btnType = String((selected.props as Record<string,unknown>)?.type ?? 'button'); if (beh==='navigate') return <><Field label="target (page)"><select value={String(act.target ?? '')} onChange={e=>updateAction('navigate', {target:e.target.value})} style={inp()}><option value="">-- pilih page --</option>{effectivePages.map(p=> <option key={p} value={p}>{p}</option>)}{effectivePages && !effectivePages.includes('home') ? <option value="home">home</option> : null}</select></Field><Field label="params (JSON)"><textarea value={act.params ? JSON.stringify(act.params,null,2) : ''} onChange={e=>{ try{ const v=JSON.parse(e.target.value); updateAction('navigate', {target:String(act.target ?? ''), params:v})}catch{}}} style={{...inp(), minHeight:60, fontFamily:'monospace', fontSize:11}} /></Field></>; if (beh==='externalLink') return <Field label="href"><input value={String(act.href ?? '')} onChange={e=>updateAction('externalLink', {href:e.target.value})} style={inp()} placeholder="https://example.com" /></Field>; if (beh==='openModal') return <><Field label="modalId"><select value={String(act.modalId ?? '')} onChange={e=>updateAction('openModal', {modalId:e.target.value})} style={inp()}><option value="">-- pilih Modal --</option>{effectiveModals.map(m=> <option key={m.id} value={m.id}>{m.id.slice(-6)}</option>)}{(effectiveModals.length===0) && <option disabled>Belum ada Modal — buat komponen Modal dulu</option>}</select></Field><Field label="title"><input value={String(act.title ?? '')} onChange={e=>updateAction('openModal', {modalId:String(act.modalId ?? ''), title:e.target.value})} style={inp()} /></Field><Field label="message"><textarea value={String(act.message ?? '')} onChange={e=>updateAction('openModal', {modalId:String(act.modalId ?? ''), message:e.target.value})} style={{...inp(), minHeight:50}} /></Field></>; if (beh==='toast') return <Field label="message"><textarea value={String(act.message ?? '')} onChange={e=>updateAction('toast', {message:e.target.value})} style={{...inp(), minHeight:50}} placeholder="Berhasil disimpan" /></Field>; if (beh==='customEvent') return <><Field label="eventName"><input value={String(act.eventName ?? '')} onChange={e=>updateAction('customEvent', {eventName:e.target.value})} style={inp()} /></Field><Field label="params (JSON)"><textarea value={act.params ? JSON.stringify(act.params,null,2) : ''} onChange={e=>{ try{ updateAction('customEvent', {eventName:String(act.eventName ?? ''), params:JSON.parse(e.target.value)})}catch{}}} style={{...inp(), minHeight:60, fontFamily:'monospace', fontSize:11}} /></Field></>; if (beh==='submit') { const isSubmitModal = !!act.modalId; return <><Field label="On success"><select value={isSubmitModal ? 'openModal' : 'navigate'} onChange={e=>{ if(e.target.value==='openModal') updateAction('submit', {modalId: effectiveModals[0]?.id ?? '', target: undefined}); else updateAction('submit', {target: effectivePages[0] ?? 'home', modalId: undefined})} } style={inp()}><option value="navigate">Redirect to page</option><option value="openModal">Open modal</option></select></Field>{isSubmitModal ? <Field label="modalId"><select value={String(act.modalId ?? '')} onChange={e=>updateAction('submit', {modalId:e.target.value})} style={inp()}><option value="">-- pilih Modal --</option>{effectiveModals.map(m=> <option key={m.id} value={m.id}>{m.id.slice(-6)}</option>)}{(effectiveModals.length===0) && <option disabled>Belum ada Modal — buat komponen Modal dulu</option>}</select></Field> : <Field label="target (page)"><select value={String(act.target ?? '')} onChange={e=>updateAction('submit', {target:e.target.value})} style={inp()}><option value="">-- pilih page --</option>{effectivePages.map(p=> <option key={p} value={p}>{p}</option>)}</select></Field>}<Field label="params (JSON)"><textarea value={act.params ? JSON.stringify(act.params,null,2) : ''} onChange={e=>{ try{ const v=JSON.parse(e.target.value); if(isSubmitModal) updateAction('submit', {modalId:String(act.modalId ?? ''), params:v}); else updateAction('submit', {target:String(act.target ?? ''), params:v})}catch{}}} style={{...inp(), minHeight:60, fontFamily:'monospace', fontSize:11}} /></Field></> } return null })()}
                  </>}
                  {['Input','Select','Textarea'].includes(String(getComponentType(selected))) && <>
                    <Field label="name"><input value={String((selected.props as Record<string,unknown>)?.name ?? '')} onChange={e=>patchSelected({name:e.target.value})} style={inp()} /></Field>
                    <Field label="label"><input value={String((selected.props as Record<string,unknown>)?.label ?? '')} onChange={e=>patchSelected({label:e.target.value})} style={inp()} /></Field>
                    <Field label="placeholder"><input value={String((selected.props as Record<string,unknown>)?.placeholder ?? '')} onChange={e=>patchSelected({placeholder:e.target.value})} style={inp()} /></Field>
                    <Field label="required"><select value={String(Boolean((selected.props as Record<string,unknown>)?.required))} onChange={e=>patchSelected({required:e.target.value==='true'})} style={inp()}><option value="false">false</option><option value="true">true</option></select></Field>
                  </>}
                  {String(getComponentType(selected))==='Input' && <>
                    <Field label="type"><select value={String((selected.props as Record<string,unknown>)?.type ?? 'text')} onChange={e=>patchSelected({type:e.target.value})} style={inp()}><option>text</option><option>email</option><option>password</option><option>number</option><option>tel</option><option>date</option></select></Field>
                    <Field label="options (Select, JSON)"><textarea value={String((selected.props as Record<string,unknown>)?.options ? JSON.stringify((selected.props as Record<string,unknown>).options) : '[]')} onChange={e=>{ try{ const v=JSON.parse(e.target.value); patchSelected({options:v}) } catch{} }} style={{...inp(), minHeight:50, fontFamily:'monospace', fontSize:11}} /></Field>
                  </>}
                  {String(getComponentType(selected))==='Select' && <Field label="options (JSON)"><textarea value={JSON.stringify((selected.props as Record<string,unknown>)?.options ?? [], null, 2)} onChange={e=>{ try{ patchSelected({options:JSON.parse(e.target.value)})}catch{} }} style={{...inp(), minHeight:60, fontFamily:'monospace', fontSize:11}} /></Field>}
                  {String(getComponentType(selected))==='Textarea' && <Field label="rows"><input type="number" value={String((selected.props as Record<string,unknown>)?.rows ?? 3)} onChange={e=>patchSelected({rows:parseInt(e.target.value)||3})} style={inp()} /></Field>}
                  {String(getComponentType(selected))==='Image' && <>
                    <Field label="src"><input value={String((selected.props as Record<string,unknown>)?.src ?? '')} onChange={e=>patchSelected({src:e.target.value})} style={inp()} /></Field>
                    <Field label="alt"><input value={String((selected.props as Record<string,unknown>)?.alt ?? '')} onChange={e=>patchSelected({alt:e.target.value})} style={inp()} /></Field>
                    <Field label="loading"><select value={String((selected.props as Record<string,unknown>)?.loading ?? 'lazy')} onChange={e=>patchSelected({loading:e.target.value})} style={inp()}><option>lazy</option><option>eager</option></select></Field>
                  </>}
                  {String(getComponentType(selected))==='Link' && <>
                    <Field label="label"><input value={String((selected.props as Record<string,unknown>)?.label ?? '')} onChange={e=>patchSelected({label:e.target.value})} style={inp()} /></Field>
                    <Field label="href"><input value={String((selected.props as Record<string,unknown>)?.href ?? '')} onChange={e=>patchSelected({href:e.target.value})} style={inp()} /></Field>
                    <Field label="target"><select value={String((selected.props as Record<string,unknown>)?.target ?? '_self')} onChange={e=>patchSelected({target:e.target.value})} style={inp()}><option>_self</option><option>_blank</option></select></Field>
                  </>}
                  {String(getComponentType(selected))==='Flex' && <>
                    <Field label="direction"><select value={String((selected.props as Record<string,unknown>)?.direction ?? 'row')} onChange={e=>patchSelected({direction:e.target.value})} style={inp()}><option>row</option><option>column</option></select></Field>
                    <Field label="gap"><input value={String((selected.props as Record<string,unknown>)?.gap ?? 'md')} onChange={e=>patchSelected({gap:e.target.value})} style={inp()} /></Field>
                    <Field label="justify"><select value={String((selected.props as Record<string,unknown>)?.justify ?? 'start')} onChange={e=>patchSelected({justify:e.target.value})} style={inp()}><option>start</option><option>center</option><option>end</option><option>between</option></select></Field>
                  </>}
                  {String(getComponentType(selected))==='Grid' && <>
                    <Field label="columns"><input type="number" value={String((selected.props as Record<string,unknown>)?.columns ?? 2)} onChange={e=>patchSelected({columns:parseInt(e.target.value)||2})} style={inp()} /></Field>
                    <Field label="gap"><input value={String((selected.props as Record<string,unknown>)?.gap ?? 'lg')} onChange={e=>patchSelected({gap:e.target.value})} style={inp()} /></Field>
                  </>}
                  {String(getComponentType(selected))==='Space' && <Field label="height"><input value={String((selected.props as Record<string,unknown>)?.height ?? 'md')} onChange={e=>patchSelected({height:e.target.value})} style={inp()} /></Field>}
                  {String(getComponentType(selected))==='Container' && <Field label="as"><select value={String((selected.props as Record<string,unknown>)?.as ?? 'div')} onChange={e=>patchSelected({as:e.target.value})} style={inp()}><option>div</option><option>section</option><option>article</option></select></Field>}
                  {String(getComponentType(selected))==='Form' && <>
                    <Field label="action"><input value={String((selected.props as Record<string,unknown>)?.action ?? '')} onChange={e=>patchSelected({action:e.target.value})} style={inp()} /></Field>
                    <Field label="method"><select value={String((selected.props as Record<string,unknown>)?.method ?? 'POST')} onChange={e=>patchSelected({method:e.target.value})} style={inp()}><option>POST</option><option>GET</option></select></Field>
                  </>}
                  <Field label="props (JSON)"><textarea value={JSON.stringify({ ...(selected.props ?? {}), ...((selected as UniversalComponent).action ? {action:(selected as UniversalComponent).action} : {}) }, null, 2)} onChange={e=>{ try{ const p=JSON.parse(e.target.value) as Record<string,unknown>; const act=p.action as Record<string,unknown> | undefined; const rest={...p}; delete (rest as Record<string,unknown>).action; stateRef.current.patch(selected.id, {props:{ ...(selected.props as object ?? {}), ...rest, ...(act?{action:act}:{})} as Record<string,unknown>, ...(act?{action: act as unknown as UniversalComponent['action'] }:{})} ); syncOut(stateRef.current.toFlatArray())}catch{}}} style={{...inp(), minHeight:70, fontFamily:'monospace', fontSize:11}} /></Field>
                </div>
              </div>

              <div style={{ border:'1px solid #2c3354', borderRadius:8, overflow:'hidden'}}>
                <h3 style={{ fontSize:11, letterSpacing:'.06em', color:'#9aa3c7', background:'#232a45', padding:'6px 8px', textTransform:'uppercase' as const}}>Style (CSS)</h3>
                <div style={{ padding:8}}>
                  <textarea value={styleToCssText(selected.style as Record<string,unknown>)} onChange={e=>{ const {style, error}=cssTextToStyle(e.target.value); if(!error){ stateRef.current.patch(selected.id, {style} as Partial<UniversalComponent>); syncOut(stateRef.current.toFlatArray())} if(error) setJsonError(error)}} style={{...inp(), minHeight:80, fontFamily:'monospace', fontSize:11}} placeholder={"background-color: #fff;\ncolor: #0f172a;"} />
                  {(() => { const t=String(getComponentType(selected)??''); const p=(selected.props ?? {}) as Record<string,unknown>; const cur=(selected.style ?? {}) as Record<string,string>; const preview=buildLayoutStyle(t,p,cur); return <div style={{ fontSize:11, color:'#9aa3c7', border:'1px solid #2c3354', borderRadius:6, padding:8, marginTop:6}}><div style={{ fontWeight:600, marginBottom:4}}>Style preview (keep netral putih)</div><pre style={{ margin:0, whiteSpace:'pre-wrap', fontSize:10}}>{JSON.stringify(preview,null,2)}</pre></div>})()}
                </div>
              </div>

              <div style={{ display:'flex', gap:6}}>
                <button onClick={()=>{ stateRef.current.duplicate(selected.id); syncOut(stateRef.current.toFlatArray()); setSelectedId(stateRef.current.get().selectedId)}} style={{...btn('#2c3354'), flex:1}}>Duplicate</button>
                <button onClick={()=>{ stateRef.current.remove(selected.id); setSelectedId(null); syncOut(stateRef.current.toFlatArray())}} style={{...btn('#ff6b6b'), flex:1}}>Delete</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div style={{ height:260, background:'#1a1f35', borderTop:'1px solid #2c3354', display:'flex', flexDirection:'column'}}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'#232a45', borderBottom:'1px solid #2c3354'}}>
          <span style={{ fontSize:12, color:'#9aa3c7'}}>JSON — flat array (2-way sync)</span>
          <button onClick={()=>{ try{ setJsonText(JSON.stringify(JSON.parse(jsonText),null,2))}catch{}}} style={{ marginLeft:'auto', ...btn('#0f1220'), fontSize:11, padding:'4px 8px'}}>Format</button>
        </div>
        <textarea value={jsonText} onChange={e=>onJsonEdit(e.target.value)} spellCheck={false} style={{ flex:1, background:'#0f1220', color:'#e6e9f5', border:0, padding:10, fontFamily:'monospace', fontSize:12, resize:'none', outline:'none'}} />
        {jsonError && <div style={{ fontSize:11, color:'#ff6b6b', padding:'4px 8px'}}>{jsonError}</div>}
      </div>
    </div>
  )
}
function btn(bg:string): React.CSSProperties{ return {height:28, padding:'0 12px', borderRadius:6, border:`1px solid ${bg}`, background:bg, color: bg==='#0f1220'||bg==='#2c3354'?'#e6e9f5':'#fff', cursor:'pointer', fontSize:13}}
function inp(): React.CSSProperties{ return {width:'100%', background:'#0f1220', border:'1px solid #2c3354', color:'#e6e9f5', borderRadius:6, padding:'6px 8px', fontSize:12}}
export default FajrinaBuilder
