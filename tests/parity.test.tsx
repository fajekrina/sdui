// @vitest-environment jsdom
/**
 * Gate: one payload → identical DOM in React, Vue and vanilla.
 * Compares tag, attributes, computed inline style, text and form values.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { createApp, nextTick } from 'vue'
import { Fajrina as ReactFajrina } from '../src/react/Fajrina'
import { Fajrina as VueFajrina } from '../src/vue/Fajrina'
import { mount } from '../src/vanilla'
import { createRuntime } from '../src/core/runtime'

const DIR = join(__dirname, '..', 'fixtures', 'valid')
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json'))

interface Shape { tag: string; attrs: Record<string, string>; style: string; text: string; value?: string; children: Shape[] }

function shape(el: Element): Shape {
  const attrs: Record<string, string> = {}
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'style' || a.name === 'value') continue
    attrs[a.name] = a.value
  }
  const html = el as HTMLElement
  const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
  const value = 'value' in html && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) ? (html as HTMLInputElement).value : undefined
  return { tag: el.tagName, attrs, style: html.style?.cssText ?? '', text, value, children: Array.from(el.children).map(shape) }
}

async function renderVue(data: unknown): Promise<Shape> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(VueFajrina, { data })
  app.mount(host)
  await nextTick()
  const s = shape(host.firstElementChild!)
  app.unmount()
  host.remove()
  return s
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('adapter parity (React = Vue = vanilla)', () => {
  for (const file of fixtures) {
    it(file, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const data = JSON.parse(readFileSync(join(DIR, file), 'utf8'))

      const { container } = render(<ReactFajrina data={data} />)
      const react = shape(container.firstElementChild!)

      const vue = await renderVue(data)

      const host = document.createElement('div')
      const view = mount(host, { data })
      const vanilla = shape(host.firstElementChild!)
      view.destroy()

      expect(react.children.length).toBeGreaterThan(0)
      expect(vue).toEqual(react)
      expect(vanilla).toEqual(react)
    })
  }

  it('core render output is deterministic for the same input', () => {
    const data = JSON.parse(readFileSync(join(DIR, 'merchant_demo-home.json'), 'utf8'))
    const rt = createRuntime({ ports: { logger: { warn: () => {}, error: () => {} } } })
    expect(rt.render(data).nodes).toEqual(rt.render(JSON.parse(JSON.stringify(data))).nodes)
  })
})
