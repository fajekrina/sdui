// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createApp, h, nextTick } from 'vue'
import { Fajrina as ReactFajrina } from '../src/react/Fajrina'
import { Fajrina as VueFajrina } from '../src/vue/Fajrina'
import { mount } from '../src/vanilla'
import { previewNode, builderPalette, defaultPropsFor } from '../src/builder/builder'
import type { FajrinaActionEvent } from '../src/core/types'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.innerHTML = '' })

const page = {
  layout: {
    components: [
      { id: 'b1', type: 'Button', props: { label: 'Ke checkout', action: { behavior: 'navigate', target: 'checkout' } } },
      { id: 't1', type: 'Button', props: { label: 'Toast', action: { behavior: 'toast', message: 'Tersimpan' } } }
    ]
  }
}

describe('React adapter', () => {
  it('routes navigate through ports.navigation and shows toasts from the store', async () => {
    const navigate = vi.fn()
    render(<ReactFajrina data={page as never} ports={{ navigation: { navigate, back: vi.fn(), openExternal: vi.fn() } }} />)
    fireEvent.click(screen.getByText('Ke checkout'))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('checkout', undefined))
    fireEvent.click(screen.getByText('Toast'))
    expect(await screen.findByText('Tersimpan')).toBeTruthy()
  })

  it('loads via `source` using the NetworkPort', async () => {
    const getPage = vi.fn(async () => ({ status: 200, body: { layout: { components: [{ id: 'h', type: 'Heading', props: { content: 'Dari server' } }] } }, etag: 'e1' }))
    const onLoad = vi.fn()
    render(<ReactFajrina source={{ merchantId: 'm', pageKey: 'home' }} ports={{ network: { getPage } }} onLoad={onLoad} />)
    expect(await screen.findByText('Dari server')).toBeTruthy()
    expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ source: 'fresh', etag: 'e1' }))
  })

  it('controlled fields keep their value across re-renders', () => {
    const form = { layout: { components: [{ id: 'f', type: 'Form', children: [{ id: 'i', type: 'Input', props: { name: 'nama', label: 'Nama' } }] }] } }
    const { container } = render(<ReactFajrina data={form as never} />)
    const input = container.querySelector('input[name="nama"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Budi' } })
    expect((container.querySelector('input[name="nama"]') as HTMLInputElement).value).toBe('Budi')
  })
})

describe('Vue adapter', () => {
  it('emits action and validationError', async () => {
    const onAction = vi.fn<(e: FajrinaActionEvent) => void>()
    const onValidationError = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const form = { layout: { components: [{ id: 'f', type: 'Form', children: [{ id: 'i', type: 'Input', props: { name: 'nama', label: 'Nama', required: true } }] }] } }
    const app = createApp({ render: () => h(VueFajrina, { data: form, onAction, onValidationError }) })
    app.mount(host)
    await nextTick()
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await nextTick()
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'validationError' }))
    expect(onValidationError).toHaveBeenCalledWith([{ field: 'nama', message: 'Nama wajib diisi' }])
    expect(host.textContent).toContain('Nama wajib diisi')
    app.unmount()
  })
})

describe('vanilla adapter', () => {
  it('keeps focus on input (no repaint on field change) and repaints on toast', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const view = mount(host, { data: { layout: { components: [{ id: 'i', type: 'Input', props: { name: 'q', label: 'Q' } }, ...page.layout.components] } } as never })
    const input = host.querySelector('input')!
    input.value = 'abc'
    input.dispatchEvent(new Event('input'))
    expect(host.querySelector('input')).toBe(input)
    ;(host.querySelectorAll('button')[1] as HTMLButtonElement).click()
    await Promise.resolve()
    expect(host.textContent).toContain('Tersimpan')
    view.destroy()
  })
})

describe('builder uses the client renderer', () => {
  it('previewNode is static (no handlers, fields disabled)', () => {
    const btn = previewNode({ id: 'b', type: 'Button', props: { label: 'X', action: { behavior: 'navigate', target: 'home' } } })
    expect(btn?.on).toBeUndefined()
    const input = previewNode({ id: 'i', type: 'Input', props: { name: 'n' } })
    expect(input?.children[1]?.attrs.disabled).toBe(true)
  })
  it('palette defaults to the core registry and honors a consumer registry', () => {
    expect(builderPalette()).toHaveLength(18)
    expect(builderPalette({ Button: {}, Text: {} })).toEqual(['Text', 'Button'])
    expect(defaultPropsFor('Heading')).toMatchObject({ content: 'Heading', level: 2 })
  })
})
