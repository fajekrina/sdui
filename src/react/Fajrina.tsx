/**
 * Fajrina SDUI — React Adapter (Universal only, agnostic, generik)
 * Style: inline CSS via buildLayoutStyle, no Tailwind/Bootstrap — true agnostic, netral.
 * Generik: semua render dari JSON, tanpa predefined selain empty/unsupported error.
 * Toast & Modal sebagai component untuk behavior toast/openModal/closeModal.
 */
import React, { useState } from 'react'
import { normalizeToLayout, getComponentType, type FajrinaData, type FajrinaActionEvent, type UniversalComponent } from '../core/types'
import { buildLayoutStyle } from '../core/style'
import { buildTree } from '../core/tree'

export interface FajrinaProps {
  data: FajrinaData
  onAction?: (event: FajrinaActionEvent) => void
  className?: string
  style?: React.CSSProperties
}

function renderInputField(
  comp: UniversalComponent,
  formData: Record<string, string>,
  setFormData: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void,
  styleOverride?: Record<string, string>
) {
  const props = (comp.props ?? {}) as Record<string, unknown>
  const merged = buildLayoutStyle('Input', props, (styleOverride ?? comp.style ?? {}) as Record<string, string>)
  const name = String(props.name ?? '')
  const label = String(props.label ?? name)
  const placeholder = String(props.placeholder ?? '')
  const required = Boolean(props.required)
  const type = String(props.type ?? 'text')
  return (
    <label key={comp.id} style={{ display: 'block', fontSize: 14 }}>
      <span style={{ color: '#374151', display: 'block', marginBottom: 4, fontSize: 13 }}>{label}{required ? <span style={{ color: '#ef4444' }}> *</span> : null}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        value={formData[name] ?? ''}
        onChange={(e) => setFormData((p) => ({ ...p, [name]: e.target.value }))}
        style={merged as React.CSSProperties}
      />
    </label>
  )
}

function renderSelectField(
  comp: UniversalComponent,
  formData: Record<string, string>,
  setFormData: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
) {
  const props = (comp.props ?? {}) as Record<string, unknown>
  const merged = buildLayoutStyle('Select', props, (comp.style ?? {}) as Record<string, string>)
  const name = String(props.name ?? '')
  const label = String(props.label ?? name)
  const placeholder = String(props.placeholder ?? 'Select')
  const required = Boolean(props.required)
  const opts = (props.options as unknown[] | undefined) ?? []
  return (
    <label key={comp.id} style={{ display: 'block', fontSize: 14 }}>
      <span style={{ color: '#374151', display: 'block', marginBottom: 4, fontSize: 13 }}>{label}{required ? <span style={{ color: '#ef4444' }}> *</span> : null}</span>
      <select
        name={name}
        required={required}
        value={formData[name] ?? ''}
        onChange={(e) => setFormData((p) => ({ ...p, [name]: e.target.value }))}
        style={merged as React.CSSProperties}
      >
        <option value="">{placeholder}</option>
        {opts.map((o: unknown) => {
          const v = typeof o === 'string' ? o : String((o as Record<string, unknown>).value ?? '')
          const l = typeof o === 'string' ? o : String((o as Record<string, unknown>).label ?? v)
          return <option key={v} value={v}>{l}</option>
        })}
      </select>
    </label>
  )
}

function renderTextareaField(
  comp: UniversalComponent,
  formData: Record<string, string>,
  setFormData: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
) {
  const props = (comp.props ?? {}) as Record<string, unknown>
  const merged = buildLayoutStyle('Textarea', props, (comp.style ?? {}) as Record<string, string>)
  const name = String(props.name ?? '')
  const label = String(props.label ?? name)
  const placeholder = String(props.placeholder ?? '')
  const rows = Number(props.rows ?? 4)
  const required = Boolean(props.required)
  return (
    <label key={comp.id} style={{ display: 'block', fontSize: 14 }}>
      <span style={{ color: '#374151', display: 'block', marginBottom: 4, fontSize: 13 }}>{label}{required ? <span style={{ color: '#ef4444' }}> *</span> : null}</span>
      <textarea
        name={name}
        placeholder={placeholder}
        rows={rows}
        required={required}
        value={formData[name] ?? ''}
        onChange={(e) => setFormData((p) => ({ ...p, [name]: e.target.value }))}
        style={merged as React.CSSProperties}
      />
    </label>
  )
}

function UniversalNode({
  comp,
  onAction,
  onToast,
  onOpenModal,
  onCloseModal
}: {
  comp: UniversalComponent
  onAction?: FajrinaProps['onAction']
  onToast?: (msg: string) => void
  onOpenModal?: (info: { id?: string; title?: string; message?: string; content?: string }) => void
  onCloseModal?: () => void
}) {
  const type = getComponentType(comp)
  const props = (comp.props ?? {}) as Record<string, unknown>
  const style = (comp.style ?? {}) as Record<string, string>
  const children = (comp.children ?? []) as UniversalComponent[]
  const [formData, setFormData] = useState<Record<string, string>>({})

  const emit = (extra?: Record<string, unknown>) => {
    const propsActionObj = (props.action && typeof props.action === 'object' ? props.action as Record<string, unknown> : undefined) ?? ((props as Record<string, unknown>).action && typeof (props as Record<string,unknown>).action === 'object' ? (props as Record<string,unknown>).action as Record<string,unknown> : undefined)
    const compActionObj = comp.action as unknown as Record<string, unknown> | undefined
    const actionObj = propsActionObj ?? compActionObj
    const behavior = (actionObj?.behavior as string | undefined) ?? (typeof props.action === 'string' ? props.action as string : undefined) ?? (props.behavior as string | undefined) ?? (compActionObj?.behavior as string | undefined) ?? (compActionObj?.action as string | undefined)
    const action = behavior
    const target = (actionObj?.target as string | undefined) ?? (props.target as string | undefined) ?? (compActionObj?.target as string | undefined)
    const ev: FajrinaActionEvent = {
      behavior: action,
      action,
      target,
      data: extra,
      params: (actionObj?.params as Record<string, unknown> | undefined) ?? (compActionObj?.params as Record<string, unknown> | undefined) ?? (props.params as Record<string, unknown> | undefined) ?? ((props as Record<string,unknown>).params as Record<string,unknown> | undefined),
      sourceComponent: comp
    }
    onAction?.(ev)
    if (action === 'externalLink') {
      const href = (actionObj?.href as string | undefined) ?? (compActionObj?.href as string | undefined) ?? (props.href as string | undefined) ?? (props.url as string | undefined) ?? ((props as Record<string,unknown>).href as string | undefined)
      if (href) window.open(href, '_blank', 'noopener')
    }
    if (action === 'back') window.history.back()
    if (action === 'toast') {
      const msg = String(actionObj?.message ?? compActionObj?.message ?? props.message ?? props.content ?? 'Toast')
      onToast?.(msg)
    }
    if (action === 'openModal') {
      const modalId = String(actionObj?.modalId ?? compActionObj?.modalId ?? props.target ?? (props as Record<string,unknown>).target ?? comp.id)
      const title = String(actionObj?.title ?? props.title ?? '')
      const message = String(actionObj?.message ?? props.message ?? '')
      onOpenModal?.({ id: modalId, title, message, content: String(props.content ?? '') })
    }
    if (action === 'closeModal') {
      onCloseModal?.()
    }
    if (action === 'customEvent' && (actionObj?.eventName || compActionObj?.eventName || props.eventName)) {
      const name = String(actionObj?.eventName ?? compActionObj?.eventName ?? props.eventName ?? 'customEvent')
      document.dispatchEvent(new CustomEvent(name, { detail: (actionObj?.params ?? compActionObj?.params ?? props.params) as Record<string, unknown> }))
      onToast?.(`Event ${name} dispatched`)
    }
  }

  const mergedStyle = (t: string, p: Record<string, unknown>, s: Record<string, string>) => buildLayoutStyle(t, p, s) as React.CSSProperties

  switch (type) {
    case 'Heading': {
      const level = Math.min(6, Math.max(1, parseInt(String(props.level ?? '2'), 10) || 2))
      const text = (props.content as string | undefined) ?? (props.text as string | undefined) ?? ''
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements
      const merged = buildLayoutStyle('Heading', props, style) as React.CSSProperties
      return React.createElement(Tag, { style: merged }, text)
    }
    case 'Text': {
      const text = (props.content as string | undefined) ?? (props.text as string | undefined) ?? ''
      const tag = (props.tag as string | undefined) && ['p', 'span', 'label'].includes(String(props.tag)) ? String(props.tag) as keyof React.JSX.IntrinsicElements : 'p'
      const merged = buildLayoutStyle('Text', props, style) as React.CSSProperties
      return React.createElement(tag, { style: merged }, text)
    }
    case 'Image': {
      const merged = { ...buildLayoutStyle('Image', props, style), maxHeight: '320px' } as React.CSSProperties
      return <img src={String(props.src ?? '')} alt={String(props.alt ?? '')} style={merged} loading={(String(props.loading ?? 'lazy') as 'lazy' | 'eager')} />
    }
    case 'Button': {
      const label = String(props.label ?? props.text ?? 'Button')
      const merged = buildLayoutStyle('Button', props, style)
      return <button type={(String(props.type ?? 'button') as 'button' | 'submit' | 'reset')} disabled={Boolean(props.disabled)} style={merged as React.CSSProperties} onClick={() => emit()}>{label}</button>
    }
    // Generik: Card/Hero/Container/Flex/Grid/Space/Divider — hanya style + children, tanpa props.title/description hardcode
    case 'Card':
    case 'Container':
    case 'Grid':
    case 'Flex':
    case 'Hero':
    case 'Space': {
      const merged = mergedStyle(type, props, style)
      return <div style={merged}>{children.map((ch) => <UniversalNode key={ch.id} comp={ch} onAction={onAction} onToast={onToast} onOpenModal={onOpenModal} onCloseModal={onCloseModal} />)}</div>
    }
    case 'Divider': {
      const merged = buildLayoutStyle('Divider', props, style) as React.CSSProperties
      if (props.label) {
        return <div style={{ display: 'flex', alignItems: 'center', gap: 12, ...merged } as React.CSSProperties}><div style={{ flex: 1, height: 1, background: '#e2e8f0' }} /><span style={{ fontSize: 12, color: '#94a3b8' }}>{String(props.label)}</span><div style={{ flex: 1, height: 1, background: '#e2e8f0' }} /></div>
      }
      return <div style={merged} />
    }
    case 'Toast': {
      const msg = String(props.message ?? props.content ?? props.text ?? '')
      const merged = buildLayoutStyle('Toast', props, style) as React.CSSProperties
      return <div style={merged}>{msg || children.map((ch) => <UniversalNode key={ch.id} comp={ch} onAction={onAction} onToast={onToast} onOpenModal={onOpenModal} onCloseModal={onCloseModal} />)}</div>
    }
    case 'Modal': {
      const merged = buildLayoutStyle('Modal', props, style) as React.CSSProperties
      return (
        <div style={merged} onClick={() => onCloseModal?.()}>
          <div
            style={{ background: '#fff', borderRadius: 12, maxWidth: 520, width: '90%', padding: 20, boxShadow: '0 10px 30px rgba(0,0,0,.2)' } as React.CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            {props.title ? <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>{String(props.title)}</h3> : null}
            {props.message || props.content ? <p style={{ fontSize: 14, color: '#475569', margin: '8px 0 0 0' }}>{String(props.message ?? props.content ?? '')}</p> : null}
            {children.length ? <div style={{ marginTop: 12 }}>{children.map((ch) => <UniversalNode key={ch.id} comp={ch} onAction={onAction} onToast={onToast} onOpenModal={onOpenModal} onCloseModal={onCloseModal} />)}</div> : null}
            <div style={{ marginTop: 12, textAlign: 'right' }}><button style={buildLayoutStyle('Button', {}, {}) as React.CSSProperties} onClick={() => onCloseModal?.()}>Close</button></div>
          </div>
        </div>
      )
    }
    case 'Form': {
      const fields = (props.fields as Array<Record<string, unknown>> | undefined) ?? []
      const hasChildren = children.length > 0
      const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const toCheck = hasChildren
          ? children.filter((ch) => ['Input', 'Select', 'Textarea'].includes(getComponentType(ch)))
          : fields.map((f) => ({ props: f } as unknown as UniversalComponent))
        for (const ch of toCheck) {
          const p = hasChildren ? ((ch as UniversalComponent).props ?? {}) as Record<string, unknown> : (ch.props as Record<string, unknown>)
          const name = String((p as Record<string, unknown>).name ?? '')
          const required = Boolean((p as Record<string, unknown>).required)
          if (required && !String(formData[name] ?? '').trim()) {
            alert(`Field ${name} is required`)
            return
          }
        }
        emit({ ...formData })
      }
      const formStyle = buildLayoutStyle('Form', props, style) as React.CSSProperties
      if (hasChildren) {
        return (
          <form onSubmit={handleSubmit} style={formStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {children.map((ch) => {
                const ct = getComponentType(ch)
                if (ct === 'Input') return renderInputField(ch, formData, setFormData)
                if (ct === 'Select') return renderSelectField(ch, formData, setFormData)
                if (ct === 'Textarea') return renderTextareaField(ch, formData, setFormData)
                if (ct === 'Button') {
                  const cp = (ch.props ?? {}) as Record<string, unknown>
                  const label = String(cp.label ?? 'Submit')
                  const merged = buildLayoutStyle('Button', cp, ch.style as Record<string, string> ?? {})
                  return <button key={ch.id} type="submit" style={merged as React.CSSProperties}>{label}</button>
                }
                return <UniversalNode key={ch.id} comp={ch} onAction={onAction} onToast={onToast} onOpenModal={onOpenModal} onCloseModal={onCloseModal} />
              })}
            </div>
          </form>
        )
      }
      return (
        <form onSubmit={handleSubmit} style={formStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map((f) => {
              const name = String(f.name)
              if (String(f.type) === 'select') {
                const opts = (f.options as unknown[] | undefined) ?? []
                return <label key={name} style={{ display: 'block', fontSize: 14 }}><span style={{ color: '#374151', display: 'block', marginBottom: 4, fontSize: 13 }}>{String(f.label ?? name)}</span><select name={name} style={buildLayoutStyle('Select', f, {}) as React.CSSProperties} required={Boolean(f.required)} value={formData[name] ?? ''} onChange={(e) => setFormData((p) => ({ ...p, [name]: e.target.value }))}><option value="">{String(f.placeholder ?? 'Select')}</option>{opts.map((o: unknown) => { const v = typeof o === 'string' ? o : String((o as Record<string, unknown>).value ?? ''); const l = typeof o === 'string' ? o : String((o as Record<string, unknown>).label ?? v); return <option key={v} value={v}>{l}</option> })}</select></label>
              }
              return <label key={name} style={{ display: 'block', fontSize: 14 }}><span style={{ color: '#374151', display: 'block', marginBottom: 4, fontSize: 13 }}>{String(f.label ?? name)}</span><input name={name} type={String(f.type ?? 'text')} placeholder={String(f.placeholder ?? '')} style={buildLayoutStyle('Input', f, {}) as React.CSSProperties} required={Boolean(f.required)} value={formData[name] ?? ''} onChange={(e) => setFormData((p) => ({ ...p, [name]: e.target.value }))} /></label>
            })}
            <button type="submit" style={buildLayoutStyle('Button', { label: String(props.submitLabel ?? 'Submit') }, {}) as React.CSSProperties}>{String(props.submitLabel ?? 'Submit')}</button>
          </div>
        </form>
      )
    }
    case 'Input':
      return renderInputField(comp, formData, setFormData, style)
    case 'Select':
      return renderSelectField(comp, formData, setFormData)
    case 'Textarea':
      return renderTextareaField(comp, formData, setFormData)
    case 'Link': {
      const href = String(props.href ?? '#')
      const label = String(props.label ?? props.text ?? 'Link')
      const target = String(props.target ?? '_self')
      const merged = buildLayoutStyle('Link', props, style) as React.CSSProperties
      return <a href={href} target={target} rel={String(props.rel ?? 'noopener noreferrer')} style={merged} onClick={(e) => { const beh = (props.action as string | undefined) ?? (comp.action?.behavior as string | undefined); if (beh) { e.preventDefault(); emit() } }}>{label}</a>
    }
    default:
      return <div style={{ padding: 8, border: '1px solid #f59e0b', background: '#fffbeb', fontSize: 12, color: '#92400e' }}>Unsupported type: {type} {children.map((ch) => <UniversalNode key={ch.id} comp={ch} onAction={onAction} onToast={onToast} onOpenModal={onOpenModal} onCloseModal={onCloseModal} />)}</div>
  }
}

export function Fajrina({ data, onAction, className, style }: FajrinaProps) {
  const layout = normalizeToLayout(data)
  if (!layout || !layout.components || layout.components.length === 0) {
    return <div className={className} style={style}><div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '48px 0' }}>No components — pass Universal JSON as data</div></div>
  }
  const hasParentId = layout.components!.some((c) => c.parentId != null)
  const roots = hasParentId ? buildTree(layout.components!) : layout.components!
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [modalInfo, setModalInfo] = useState<{ id?: string; title?: string; message?: string } | null>(null)

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }
  const openModal = (info: { id?: string; title?: string; message?: string }) => setModalInfo({ ...info, id: info.id ?? 'modal' })
  const closeModal = () => setModalInfo(null)

  return (
    <div className={className} style={style}>
      {roots.map((c) => <UniversalNode key={c.id} comp={c} onAction={onAction} onToast={showToast} onOpenModal={openModal} onCloseModal={closeModal} />)}
      {toastMsg ? <div style={buildLayoutStyle('Toast', {}, {}) as React.CSSProperties}>{toastMsg}</div> : null}
      {modalInfo ? (
        <div style={buildLayoutStyle('Modal', {}, {}) as React.CSSProperties} onClick={closeModal}>
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 520, width: '90%', padding: 20, boxShadow: '0 10px 30px rgba(0,0,0,.2)' } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
            {modalInfo.title ? <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>{modalInfo.title}</h3> : <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>Modal {modalInfo.id}</h3>}
            {modalInfo.message ? <p style={{ fontSize: 14, color: '#475569', margin: '8px 0 0 0' }}>{modalInfo.message}</p> : <p style={{ fontSize: 14, color: '#475569', margin: '8px 0 0 0' }}>Ini modal overlay.</p>}
            <div style={{ marginTop: 12, textAlign: 'right' }}><button style={buildLayoutStyle('Button', {}, {}) as React.CSSProperties} onClick={closeModal}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Fajrina
