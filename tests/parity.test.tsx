// Gate: one payload → identical DOM from React, Vue and vanilla (the core makes
// every decision; renderers are generic).
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render as renderReact, cleanup, act } from '@testing-library/react'
import { createApp, h, nextTick } from 'vue'
import { ScreenSource, createEngine } from '../src/core'
import { SduiScreen as ReactScreen } from '../src/react'
import { SduiScreen as VueScreen } from '../src/vue'
import { mount } from '../src/vanilla'
import { fixture, flush , devEngine } from './helpers'

const FIXTURES = ['valid/dashboard.json', 'valid/login.json', 'valid/transfer_form.json', 'valid/home_load.json', 'valid/third_party_lottie.json']
const SEED = { user: { name: 'Ada', segment: 'gold' }, getBalance: { amount: 1250 }, getPromos: { items: [{ title: 'Cashback' }] } }

/// Canonical form: tag, attributes sorted (style declarations sorted), text —
/// attribute order is not semantic; anything else that differs is a real diff.
function normalize(root: Element): string {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').trim() ? `"${node.textContent}"` : ''
    if (node.nodeType !== 1) return ''
    const el = node as Element
    const attrs = [...el.attributes]
      .filter((a) => a.name !== 'data-sdui-key' && !(a.name === 'value' && a.value === ''))
      .map((a) => (a.name === 'style' ? `style=${a.value.split(';').map((d) => d.trim()).filter(Boolean).sort().join(';')}` : `${a.name}=${a.value}`))
      .sort()
    return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${[...el.childNodes].map(walk).join('')}</>`
  }
  return [...root.childNodes].map(walk).join('')
}

async function reactDOM(source: Uint8Array): Promise<string> {
  const engine = devEngine()
  let container!: HTMLElement
  await act(async () => {
    container = renderReact(<ReactScreen engine={engine} source={ScreenSource.inline(source)} seed={SEED} />).container
  })
  await act(async () => { await flush() })
  const html = normalize(container.querySelector('[data-sdui-screen]')!)
  cleanup()
  return html
}

async function vueDOM(source: Uint8Array): Promise<string> {
  const engine = devEngine()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ render: () => h(VueScreen, { engine, source: ScreenSource.inline(source), seed: SEED }) })
  app.mount(host)
  await flush(); await nextTick(); await flush(); await nextTick()
  const html = normalize(host.querySelector('[data-sdui-screen]')!)
  app.unmount()
  host.remove()
  return html
}

async function vanillaDOM(source: Uint8Array): Promise<string> {
  const engine = devEngine()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const view = mount(host, { engine, source: ScreenSource.inline(source), seed: SEED })
  await flush(); await flush()
  const html = normalize(host.querySelector('[data-sdui-screen]')!)
  view.destroy()
  host.remove()
  return html
}

describe('renderer parity', () => {
  it.each(FIXTURES)('%s renders identically in React, Vue and vanilla', async (name) => {
    const source = fixture(name)
    const [r, v, d] = [await reactDOM(source), await vueDOM(source), await vanillaDOM(source)]
    expect(r.length).toBeGreaterThan(50)
    expect(v).toBe(r)
    expect(d).toBe(r)
  })
})

describe('interaction through each renderer', () => {
  it('React: typing + click runs the form action', async () => {
    const engine = devEngine()
    const payload = { schemaVersion: '1.1', screen: { key: 's', root: { type: 'form', id: 'f', children: [
      { type: 'textField', props: { name: 'who', required: true } },
      { type: 'button', props: { title: 'Go' }, action: { type: 'toast', message: 'Hi {{form.who}}' } }
    ] } } }
    const { container } = renderReact(<ReactScreen engine={engine} source={{ payload }} />)
    await act(async () => { await flush() })
    const input = container.querySelector('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Ada')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { container.querySelector('button')!.click(); await flush() })
    expect(container.textContent).toContain('Hi Ada')
    cleanup()
  })

  it('vanilla: typing keeps focus; click runs the action', async () => {
    const engine = devEngine()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const payload = { schemaVersion: '1.1', screen: { key: 's', root: { type: 'form', id: 'f', children: [
      { type: 'textField', props: { name: 'who' } },
      { type: 'button', props: { title: 'Go' }, action: { type: 'toast', message: 'Hi {{form.who}}' } }
    ] } } }
    const view = mount(host, { engine, source: { payload } })
    await flush()
    const input = host.querySelector('input')!
    input.focus()
    input.value = 'Ada'
    input.dispatchEvent(new Event('input'))
    expect((document.activeElement as HTMLElement).tagName).toBe('INPUT')
    host.querySelector('button')!.click()
    await flush()
    expect(host.textContent).toContain('Hi Ada')
    view.destroy()
  })
})
