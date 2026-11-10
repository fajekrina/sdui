/**
 * Gate: the core must stay framework-free and DOM-free. One stray import here
 * breaks the agnostic promise, so this runs on every `npm test`.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CORE = join(__dirname, '..', 'src', 'core')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['react import', /from\s+['"]react(-dom)?(\/[^'"]*)?['"]/],
  ['vue import', /from\s+['"]vue['"]/],
  ['browser adapter import', /from\s+['"]\.\.\/(browser|react|vue|vanilla|builder)/],
  ['window', /(?<![.\w$])window\s*[.[(]/],
  ['document', /(?<![.\w$])document\s*[.[(]/],
  ['localStorage', /(?<![.\w$])(local|session)Storage\b/],
  ['navigator', /(?<![.\w$])navigator\s*\./],
  ['history', /(?<![.\w$])history\s*\./],
  ['bare fetch', /(?<![.\w$])fetch\s*\(/],
  ['bare crypto', /(?<![.\w$])crypto\s*\./]
]

/**
 * Explicit, temporary exceptions. Each one is a deprecated 0.2 API that keeps
 * its old behavior until 1.0 (see CHANGELOG "Deprecated"); new code must use ports.
 */
const ALLOWED: Record<string, string[]> = {
  'cache.ts': ['localStorage'] // loadPageWithCache default store (globalThis.localStorage) — removed in 1.0
}

describe('core purity gate', () => {
  const files = readdirSync(CORE).filter((f) => f.endsWith('.ts'))
  it('finds the core sources', () => {
    expect(files.length).toBeGreaterThan(10)
  })
  for (const file of files) {
    it(`${file} has no framework/DOM access`, () => {
      const src = stripComments(readFileSync(join(CORE, file), 'utf8'))
      const hits = FORBIDDEN.filter(([, re]) => re.test(src)).map(([name]) => name)
        .filter((name) => !(ALLOWED[file] ?? []).includes(name))
      expect(hits).toEqual([])
    })
  }
})
