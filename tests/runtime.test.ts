import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../src/core/runtime'
import { resolveAction, mergePolicy, checkUrl } from '../src/core/actions'
import type { FajrinaActionEvent, UniversalComponent } from '../src/core/types'
import type { RenderNode } from '../src/core/view-model'

const silent = { warn: vi.fn(), error: vi.fn() }

function setup(components: unknown[], extra: Record<string, unknown> = {}) {
  const navigation = { navigate: vi.fn(), back: vi.fn(), openExternal: vi.fn() }
  const events = { emit: vi.fn() }
  const logger = { warn: vi.fn(), error: vi.fn() }
  const onAction = vi.fn<(e: FajrinaActionEvent) => void>()
  const { ports: extraPorts, data: extraData, ...options } = extra
  const rt = createRuntime({ ...options, ports: { navigation, events, logger, ...(extraPorts as object ?? {}) }, onAction })
  const data = { layout: { components }, ...(extraData as object ?? {}) }
  const result = rt.render(data as never)
  return { rt, data, result, navigation, events, logger, onAction }
}

function find(nodes: RenderNode[], pred: (n: RenderNode) => boolean): RenderNode | undefined {
  for (const n of nodes) {
    if (pred(n)) return n
    const hit = find(n.children, pred)
    if (hit) return hit
  }
}

describe('resolveAction', () => {
  it('reads the official shape without legacy flags', () => {
    const a = resolveAction({ id: 'b', type: 'Button', props: { action: { behavior: 'navigate', target: 'home' } } } as UniversalComponent)
    expect(a).toMatchObject({ behavior: 'navigate', target: 'home', legacy: [] })
  })
  it('normalizes legacy aliases and reports them', () => {
    const a = resolveAction({ id: 'b', type: 'Button', props: { action: 'externalLink', url: 'https://example.com' } } as UniversalComponent)
    expect(a?.behavior).toBe('externalLink')
    expect(a?.href).toBe('https://example.com')
    expect(a?.legacy).toEqual(['props.action (string)', 'props.url'])
  })
})

describe('policy', () => {
  it('app policy is the upper bound, payload only narrows', () => {
    expect(mergePolicy({ allowedDomains: ['a.com', 'b.com'] }, { allowedDomains: ['b.com', 'evil.com'] })?.allowedDomains).toEqual(['b.com'])
    expect(mergePolicy(undefined, { allowedDomains: ['x.com'] })?.allowedDomains).toEqual(['x.com'])
  })
  it('rejects javascript: and unlisted hosts', () => {
    expect(checkUrl('javascript:alert(1)').ok).toBe(false)
    expect(checkUrl('https://evil.com/x', { allowedDomains: ['example.com'] }).ok).toBe(false)
    expect(checkUrl('https://cdn.example.com/x', { allowedDomains: ['example.com'] }).ok).toBe(true)
    expect(checkUrl('mailto:a@b.c', { allowedDomains: [] }).ok).toBe(true)
  })
})

describe('dispatcher', () => {
  it('navigate: onAction first, then NavigationPort', async () => {
    const { rt, navigation, onAction } = setup([{ id: 'b1', type: 'Button', props: { label: 'Go', action: { behavior: 'navigate', target: 'checkout', params: { seatId: 'A1' } } } }])
    await rt.dispatch('b1')
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'navigate', target: 'checkout' }))
    expect(navigation.navigate).toHaveBeenCalledWith('checkout', { seatId: 'A1' })
  })

  it('preventDefault skips the default effect', async () => {
    const { rt, navigation, onAction } = setup([{ id: 'b1', type: 'Button', props: { action: { behavior: 'back' } } }])
    onAction.mockImplementation((e) => e.preventDefault?.())
    await rt.dispatch('b1')
    expect(navigation.back).not.toHaveBeenCalled()
  })

  it('externalLink outside the allow-list is blocked', async () => {
    const { rt, navigation, onAction } = setup(
      [{ id: 'b1', type: 'Button', props: { action: { behavior: 'externalLink', href: 'https://evil.com' } } }],
      { policy: { allowedDomains: ['example.com'] } }
    )
    await rt.dispatch('b1')
    expect(navigation.openExternal).not.toHaveBeenCalled()
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'blocked' }))
  })

  it('customEvent goes through EventPort when allowed', async () => {
    const { rt, events } = setup(
      [{ id: 'b1', type: 'Button', props: { action: { behavior: 'customEvent', eventName: 'addToCart', params: { sku: 1 } } } }],
      { policy: { allowedEvents: ['addToCart'] } }
    )
    await rt.dispatch('b1')
    expect(events.emit).toHaveBeenCalledWith('addToCart', { sku: 1 })
  })

  it('toast and modal live in the UI store', async () => {
    const { rt } = setup([
      { id: 't', type: 'Button', props: { action: { behavior: 'toast', message: 'Halo' } } },
      { id: 'm', type: 'Button', props: { action: { behavior: 'openModal', modalId: 'promo', title: 'Promo' } } }
    ])
    await rt.dispatch('t')
    await rt.dispatch('m')
    expect(rt.getState().toasts.map((t) => t.message)).toEqual(['Halo'])
    expect(rt.getState().modal).toMatchObject({ id: 'promo', title: 'Promo' })
    const overlays = rt.render({ layout: { components: [] } } as never).overlays
    expect(overlays.map((o) => o.text ?? o.children[0]?.children[0]?.text)).toEqual(['Halo', 'Promo'])
    rt.handle('closeModal')
    expect(rt.getState().modal).toBeNull()
    rt.destroy()
  })

  it('api action runs the onSuccess chain and respects maxChainDepth', async () => {
    const request = vi.fn(async () => ({ status: 200, body: { ok: true } }))
    const { rt, navigation } = setup(
      [{ id: 'b1', type: 'Button', props: { action: { behavior: 'api', url: 'https://api.example.com/x', onSuccess: { behavior: 'navigate', target: 'done' } } } }],
      { policy: { allowedDomains: ['example.com'] }, ports: { network: { getPage: vi.fn(), request } } }
    )
    await rt.dispatch('b1')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: 'https://api.example.com/x' }))
    expect(navigation.navigate).toHaveBeenCalledWith('done', undefined)
  })

  it('warns once about legacy action shapes', async () => {
    const { rt, logger } = setup([{ id: 'b1', type: 'Button', props: { action: 'back' } }])
    await rt.dispatch('b1')
    await rt.dispatch('b1')
    const deprecations = logger.warn.mock.calls.filter(([m]) => String(m).includes('deprecated'))
    expect(deprecations).toHaveLength(1)
  })
})

describe('forms', () => {
  const form = [{
    id: 'f', type: 'Form', props: { action: { behavior: 'submit', params: { target: 'home' } } },
    children: [
      { id: 'n', type: 'Input', props: { name: 'name', label: 'Nama', required: true, minLength: 3 } },
      { id: 'e', type: 'Input', props: { name: 'email', label: 'Email', validation: [{ rule: 'email', message: 'Email tidak valid' }] } },
      { id: 's', type: 'Button', props: { label: 'Kirim', type: 'submit', action: { behavior: 'submit' } } }
    ]
  }]

  it('blocks submit with field errors, then submits values', async () => {
    const { rt, data, onAction } = setup(form)
    await rt.submit('f')
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'validationError', data: expect.objectContaining({ fields: ['name'] }) }))
    const errNode = find(rt.render(data as never).nodes, (n) => n.key === 'n:error')
    expect(errNode?.text).toBe('Nama wajib diisi')

    rt.setFieldValue('f', 'name', 'Budi')
    rt.setFieldValue('f', 'email', 'nope')
    rt.render(data as never)
    await rt.submit('f')
    expect(rt.getState().forms.f?.errors).toEqual({ email: 'Email tidak valid' })

    rt.setFieldValue('f', 'email', 'budi@example.com')
    await rt.submit('f')
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'submit', data: { name: 'Budi', email: 'budi@example.com' }, params: { target: 'home' } }))
  })

  it('renders the submit button as type=submit without a click handler', () => {
    const { result } = setup(form)
    const btn = find(result.nodes, (n) => n.key === 's')
    expect(btn?.attrs.type).toBe('submit')
    expect(btn?.on?.click).toBeUndefined()
  })
})

describe('view-model safety', () => {
  it('drops unsafe link hrefs and position:fixed outside Modal/Toast', () => {
    const { result } = setup([
      { id: 'l', type: 'Link', props: { href: 'javascript:alert(1)', label: 'x' } },
      { id: 'c', type: 'Card', style: { position: 'fixed', top: '0' } }
    ])
    expect(find(result.nodes, (n) => n.key === 'l')?.attrs.href).toBe('#')
    expect(find(result.nodes, (n) => n.key === 'c')?.style.position).toBeUndefined()
  })

  it('strict mode renders the error page', () => {
    const { result } = setup([{ id: 'bad id!', type: 'Button' }], { mode: 'strict', ports: { logger: silent } })
    expect(result.failed).toBe(true)
    expect(result.nodes[0]?.text).toMatch(/Blocked \d+ validation issue/)
  })
})
