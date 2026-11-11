// Gate: the engine (src/core, src/spec, src/ports, src/compat) is headless — no
// framework imports and no browser globals. Effects only through ports.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers'

const PURE_DIRS = ['src/core', 'src/spec', 'src/ports', 'src/compat']
const FORBIDDEN_IMPORTS = /from\s+['"](react|react-dom|vue)(\/[^'"]*)?['"]/
/// `crypto.randomUUID()` is allowed: a randomness source, not I/O (available in
/// every supported engine: Chromium 92+, Safari 15.4+, Node 19+).
const FORBIDDEN_GLOBALS = /(?<![.\w$])(window|document|localStorage|sessionStorage|indexedDB|navigator|history|fetch|XMLHttpRequest)\s*[.(]|(?<![.\w$])crypto\.(subtle|getRandomValues)|globalThis\.(window|document|fetch|indexedDB|localStorage)|globalThis\.crypto\.(subtle|getRandomValues)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}

/// Code only: strip block and line comments (doc comments mention window, fetch…).
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

describe('core purity', () => {
  const all = PURE_DIRS.flatMap((d) => files(join(ROOT, d)))

  it('finds the engine sources', () => expect(all.length).toBeGreaterThan(20))

  it.each(all.map((f) => relative(ROOT, f)))('%s has no framework import and no browser global', (file) => {
    const src = code(readFileSync(join(ROOT, file), 'utf8'))
    expect(src).not.toMatch(FORBIDDEN_IMPORTS)
    expect(src).not.toMatch(FORBIDDEN_GLOBALS)
  })
})
