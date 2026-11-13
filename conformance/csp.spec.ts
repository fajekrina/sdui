// HLD Target F4 gate: no CSP or Trusted Types violation from the renderers or the Studio
// under `style-src 'self'` + `require-trusted-types-for 'script'`.
// Engines: CSP_ENGINES (default chromium,firefox,webkit); Trusted Types only exist in Chromium.
import { chromium, firefox, webkit, expect, test, type BrowserType } from '@playwright/test'
import { readdirSync } from 'node:fs'

const FIXTURES = readdirSync('spec/fixtures/valid').filter((f) => f.endsWith('.json') && f !== 'envelope.json')
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit }
const names = (process.env.CSP_ENGINES ?? 'chromium,firefox,webkit').split(',').map((n) => n.trim())

for (const name of names) {
  test(`strict CSP: no violation in ${name}`, async ({ baseURL }) => {
    const browser = await ENGINES[name]!.launch()
    try {
      const page = await browser.newPage()
      await page.goto(`${baseURL}/conformance/csp.html?fixtures=${FIXTURES.join(',')}`)
      await page.waitForFunction(() => (window as unknown as { __csp?: { ready: boolean } }).__csp?.ready === true)
      const result = await page.evaluate(() => (window as unknown as { __csp: { violations: string[]; studioStyled: boolean } }).__csp)
      expect(result.violations).toEqual([])
      expect(result.studioStyled).toBe(true)
      expect(await page.locator('[data-sdui-screen]').count()).toBe(FIXTURES.length)
    } finally {
      await browser.close()
    }
  })
}
