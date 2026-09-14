/**
 * @fajekrina/sdui — Builder headless (agnostic)
 * Port of universal-builder.html helpers — no DOM, no fetch, headless state only.
 * Consumer provides onSave callback (no hardcode API_BASE).
 */
import type { UniversalComponent, UniversalLayout, FajrinaData } from '../core/types'
import { normalizeToLayout } from '../core/types'

export function genId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let t = Date.now(), timeChars = ''
  for (let i = 9; i >= 0; i--) { timeChars = alphabet[t % 32] + timeChars; t = Math.floor(t / 32) }
  let rand = ''; for (let i = 0; i < 16; i++) rand += alphabet[Math.floor(Math.random() * 32)]
  return (timeChars + rand).slice(-26)
}

export function styleToCssText(style: Record<string, unknown> | undefined): string {
  if (!style) return ''
  return Object.entries(style).map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${v};`).join('\n')
}

export function cssTextToStyle(cssText: string): { style: Record<string, string>, error: string | null } {
  const style: Record<string, string> = {}
  for (const part of cssText.split(';')) {
    const p = part.trim(); if (!p) continue
    const idx = p.indexOf(':'); if (idx === -1) return { style: {}, error: `Baris "${p}" harus format "prop: value;"` }
    const rawKey = p.slice(0, idx).trim(); const val = p.slice(idx + 1).trim()
    if (!rawKey || !val) continue
    const camel = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    style[camel] = val
  }
  return { style, error: null }
}

// headless state
export interface BuilderState {
  components: UniversalComponent[]
  selectedId: string | null
}

export function createBuilderState(initial?: FajrinaData): {
  get(): BuilderState
  setComponents(comps: UniversalComponent[]): void
  setSelected(id: string | null): void
  add(type: string, parentId?: string | null): UniversalComponent
  patch(id: string, patch: Partial<UniversalComponent> & { props?: Record<string, unknown>, style?: Record<string, string> }): void
  remove(id: string): void
  duplicate(id: string): UniversalComponent | null
  toLayout(): UniversalLayout
  toFlatArray(): UniversalComponent[]
  fromLayout(layout: UniversalLayout | null): void
} {
  const layout = normalizeToLayout(initial ?? null)
  let components: UniversalComponent[] = layout?.components ? layout.components.map(c => ({ ...c, props: { ...(c.props as object) }, style: { ...(c.style as object) } } as UniversalComponent)) : []
  // ensure order
  components.forEach((c, i) => { if (c.order == null) c.order = i })
  let selectedId: string | null = null

  return {
    get: () => ({ components: [...components], selectedId }),
    setComponents(comps) { components = comps.map(c => ({ ...c })); },
    setSelected(id) { selectedId = id },
    add(type, parentId = null) {
      const maxOrder = components.length ? Math.max(...components.map(c => c.order ?? 0)) : -1
      const comp: UniversalComponent = {
        id: genId(),
        type: type as UniversalComponent['type'],
        component: type as UniversalComponent['type'],
        props: {},
        style: {},
        parentId: parentId ?? null,
        order: maxOrder + 1,
        children: []
      } as UniversalComponent
      components.push(comp)
      selectedId = comp.id
      return comp
    },
    patch(id, patch) {
      const idx = components.findIndex(c => c.id === id)
      if (idx === -1) return
      const cur = components[idx]
      // deep merge props.action + top-level action sync
      const next: UniversalComponent = { ...cur, ...patch } as UniversalComponent
      if (patch.props) {
        const curAction = (cur.props as Record<string, unknown>)?.action as Record<string, unknown> | undefined
        const patchAction = (patch.props as Record<string, unknown>)?.action as Record<string, unknown> | undefined
        const mergedAction = patchAction ? { ...(curAction ?? {}), ...patchAction } : curAction
        next.props = { ...(cur.props as object ?? {}), ...patch.props } as Record<string, unknown>
        if (mergedAction && Object.keys(mergedAction).length) (next.props as Record<string, unknown>).action = mergedAction
        else if (patchAction === null) delete (next.props as Record<string, unknown>).action
      }
      if ((patch as Record<string, unknown>).action !== undefined) {
        const curTop = (cur as unknown as Record<string, unknown>).action as Record<string, unknown> | undefined
        const patchTop = (patch as Record<string, unknown>).action as Record<string, unknown> | undefined
        if (patchTop) next.action = { ...(curTop ?? {}), ...patchTop } as unknown as UniversalComponent['action']
        else next.action = undefined as unknown as UniversalComponent['action']
        // sync props.action with top-level
        if (next.action) (next.props as Record<string, unknown>).action = next.action as unknown as Record<string, unknown>
      }
      if (patch.style) next.style = { ...(cur.style as object ?? {}), ...patch.style } as Record<string, string>
      components[idx] = next
    },
    remove(id) {
      const toDelete = new Set([id])
      let changed = true
      while (changed) { changed = false; components.forEach(c => { if (c.parentId && toDelete.has(c.parentId) && !toDelete.has(c.id)) { toDelete.add(c.id); changed = true } }) }
      components = components.filter(c => !toDelete.has(c.id))
      if (selectedId && toDelete.has(selectedId)) selectedId = null
    },
    duplicate(id) {
      const orig = components.find(c => c.id === id)
      if (!orig) return null
      const maxOrder = Math.max(...components.map(c => c.order ?? 0), -1)
      const copy: UniversalComponent = { ...orig, id: genId(), order: maxOrder + 1, props: JSON.parse(JSON.stringify(orig.props ?? {})), style: { ...(orig.style as object) } } as UniversalComponent
      components.push(copy)
      selectedId = copy.id
      return copy
    },
    toLayout() { return { type: 'Container', components: [...components] } },
    toFlatArray() { return [...components] },
    fromLayout(l) {
      components = l?.components ? l.components.map(c => ({ ...c } as UniversalComponent)) : []
      components.forEach((c, i) => { if (c.order == null) c.order = i })
      selectedId = null
    }
  }
}
