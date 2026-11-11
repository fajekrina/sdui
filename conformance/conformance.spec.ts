// Gate: one bundle, two engines. Every valid spec fixture renders the same DOM
// and the same layout in Chromium (Android WebView) and WebKit (WKWebView).
import { chromium, firefox, webkit, expect, test, type Browser, type BrowserType } from '@playwright/test'
import { readdirSync } from 'node:fs'

const FIXTURES = readdirSync('spec/fixtures/valid').filter((f) => f.endsWith('.json') && f !== 'envelope.json')
const STYLE_KEYS = ['display', 'flex-direction', 'align-items', 'gap', 'padding-top', 'padding-left', 'font-size', 'font-weight', 'color', 'background-color', 'border-radius']
const TOLERANCE_PX = 2
/// Computed-value spellings that mean the same thing (engines serialize differently).
const SAME: Record<string, string> = { 'flow-start': 'flex-start', 'flow-end': 'flex-end', start: 'flex-start', end: 'flex-end', normal: 'stretch' }
/// Flex/grid container properties only affect layout on flex/grid containers;
/// elsewhere engines leave UA defaults (e.g. WebKit `<select>`: `unsafe center`).
const CONTAINER_KEYS = ['align-items', 'flex-direction', 'gap']
const canon = (style: Record<string, string>) => {
  const container = /(^|-)(flex|grid)$/.test(style.display ?? '')
  return Object.fromEntries(Object.entries(style)
    .filter(([k]) => container || !CONTAINER_KEYS.includes(k))
    .map(([k, v]) => [k, SAME[v] ?? v]))
}
/// The engine pair to compare. CI: chromium,webkit. `CONFORMANCE_PAIR=chromium,chromium`
/// smoke-tests the harness where WebKit can't run (e.g. Windows without its system DLLs).
const ENGINES: Record<string, BrowserType> = { chromium, webkit, firefox }
const [LEFT, RIGHT] = (process.env.CONFORMANCE_PAIR ?? 'chromium,webkit').split(',').map((n) => ENGINES[n.trim()]!)

/// Structure + attributes + a computed-style subset + rounded boxes, per element.
async function snapshot(browser: Browser, fixture: string, baseURL: string) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await page.goto(`${baseURL}/conformance/index.html?fixture=${fixture}`)
  await page.waitForFunction(() => (window as unknown as { __sduiReady?: boolean }).__sduiReady === true)
  const result = await page.evaluate((keys) => {
    const root = document.querySelector('[data-sdui-screen]')!
    // <option>s of a closed <select> are drawn by the platform popup, not laid out in
    // the page — their computed style and box are meaningless. Their values and
    // labels are compared as part of the <select> instead.
    return [...root.querySelectorAll('*')].filter((el) => el.tagName !== 'OPTION').map((el) => {
      const cs = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const options = el.tagName === 'SELECT' ? [...el.querySelectorAll('option')].map((o) => `${o.value}:${o.textContent}`).join('|') : ''
      return {
        tag: el.tagName.toLowerCase(),
        attrs: [...el.attributes].filter((a) => a.name !== 'style').map((a) => `${a.name}=${a.value}`).sort().join(' ') + (options ? ` options=${options}` : ''),
        text: el.childNodes.length && el.firstChild?.nodeType === 3 ? el.firstChild.textContent : '',
        style: Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)])),
        box: [box.x, box.y, box.width, box.height]
      }
    })
  }, STYLE_KEYS)
  await page.close()
  return result
}

for (const fixture of FIXTURES) {
  test(`${fixture}: Chromium ≡ WebKit`, async ({ baseURL }) => {
    const [c, w] = await Promise.all([LEFT!.launch(), RIGHT!.launch()])
    try {
      const [a, b] = await Promise.all([snapshot(c, fixture, baseURL!), snapshot(w, fixture, baseURL!)])
      expect(b.length).toBe(a.length)
      a.forEach((el, i) => {
        const other = b[i]!
        expect(other.tag, `element ${i}`).toBe(el.tag)
        expect(other.attrs, `${el.tag}[${i}] attrs`).toBe(el.attrs)
        expect(other.text, `${el.tag}[${i}] text`).toBe(el.text)
        expect(canon(other.style), `${el.tag}[${i}] style`).toEqual(canon(el.style))
        el.box.forEach((v, j) => expect(Math.abs(other.box[j]! - v), `${el.tag}[${i}] box[${j}]`).toBeLessThanOrEqual(TOLERANCE_PX * (j < 2 ? 1 + i / 10 : 1)))
      })
    } finally {
      await Promise.all([c.close(), w.close()])
    }
  })
}
