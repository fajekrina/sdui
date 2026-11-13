// HLD Target F4 · strict CSP (`style-src 'self'`, `require-trusted-types-for 'script'`).
// Static gate over all of src/, plus a runtime check that the renderers and the Studio
// never set a `style` attribute or insert a `<style>` element: styles go through CSSOM
// (`element.style.setProperty`, constructable stylesheets), which a strict CSP allows.
// (A serialized `outerHTML` still shows `style="…"` after CSSOM writes — what CSP blocks
// is setting it as markup or as an attribute, so that is what is measured.)
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render as renderReact, cleanup, act } from '@testing-library/react'
import { createApp, h, nextTick } from 'vue'
import { ScreenSource } from '../src/core'
import { SduiScreen as ReactScreen } from '../src/react'
import { SduiScreen as VueScreen } from '../src/vue'
import { mount } from '../src/vanilla'
import { EditorDocument, mountStudio } from '../src/builder'
import { ROOT, devEngine, fixture, flush } from './helpers'

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
})

// Trusted Types sinks and inline-style/script sinks that a strict CSP blocks
const FORBIDDEN = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|new Function\s*\(|(?<![.\w$])eval\s*\(|setAttribute\(\s*['"]style['"]|\bstyle\s*:\s*['"`]/
// the one allowed `<style>`: the Studio fallback for engines without constructable stylesheets
const STYLE_ELEMENT = /createElement\(\s*['"]style['"]\)|el\(\s*['"]style['"]/

describe('CSP gate: src/ has no Trusted-Types sinks, inline-style strings or style attributes', () => {
  const all = files(join(ROOT, 'src'))
  it.each(all.map((f) => relative(ROOT, f)))('%s', (file) => {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
    const bad = lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => !/^\s*\/\//.test(l) && FORBIDDEN.test(l))
    expect(bad).toEqual([])
    const styleElements = lines.filter((l) => STYLE_ELEMENT.test(l)).length
    expect(styleElements).toBe(file.replace(/\\/g, '/') === 'src/builder/studio.ts' ? 1 : 0)
  })
})

describe('CSP runtime: no style attribute, no <style> element', () => {
  let setAttr: ReturnType<typeof vi.spyOn>
  let created: string[]
  let createSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    setAttr = vi.spyOn(Element.prototype, 'setAttribute')
    created = []
    const original = Document.prototype.createElement
    createSpy = vi.spyOn(Document.prototype, 'createElement').mockImplementation(function (this: Document, tag: string, opts?: ElementCreationOptions) {
      created.push(tag.toLowerCase())
      return original.call(this, tag, opts)
    })
  })
  afterEach(() => { setAttr.mockRestore(); createSpy.mockRestore(); cleanup() })
  const styleAttrs = () => (setAttr.mock.calls as unknown[][]).filter((c) => String(c[0]).toLowerCase() === 'style')

  const source = () => ScreenSource.inline(fixture('valid/dashboard.json'))
  const SEED = { user: { name: 'Ada', segment: 'gold' } }

  it('vanilla', async () => {
    const host = document.createElement('div')
    mount(host, { engine: devEngine(), source: source(), seed: SEED })
    await flush(); await flush()
    expect(host.querySelector('[data-sdui-screen]')!.children.length).toBeGreaterThan(0)
    expect(styleAttrs()).toEqual([])
    expect(created).not.toContain('style')
  })

  it('React', async () => {
    let container!: HTMLElement
    await act(async () => { container = renderReact(<ReactScreen engine={devEngine()} source={source()} seed={SEED} />).container })
    await act(async () => { await flush() })
    expect(container.querySelector('[data-sdui-screen]')).not.toBeNull()
    expect(styleAttrs()).toEqual([])
    expect(created).not.toContain('style')
  })

  it('Vue', async () => {
    const host = document.createElement('div')
    const app = createApp({ render: () => h(VueScreen, { engine: devEngine(), source: source(), seed: SEED }) })
    app.mount(host)
    await flush(); await nextTick(); await flush()
    expect(host.querySelector('[data-sdui-screen]')).not.toBeNull()
    expect(styleAttrs()).toEqual([])
    expect(created).not.toContain('style')
    app.unmount()
  })

  it('Studio: a constructable stylesheet, removed on destroy; `external` installs none', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const before = document.adoptedStyleSheets.length
    const doc = new EditorDocument()
    doc.importJSON(JSON.parse(new TextDecoder().decode(fixture('valid/dashboard.json'))))
    const studio = mountStudio(host, { document: doc })
    expect(document.adoptedStyleSheets.length).toBe(before + 1)
    expect(host.querySelector('style')).toBeNull()
    expect(created).not.toContain('style')
    expect(styleAttrs()).toEqual([])
    studio.destroy()
    expect(document.adoptedStyleSheets.length).toBe(before)
    mountStudio(host, { stylesheet: 'external' }).destroy()
    expect(document.adoptedStyleSheets.length).toBe(before)
    host.remove()
  })
})
