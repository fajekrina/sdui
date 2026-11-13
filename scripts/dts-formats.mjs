// Post-build: declaration files per module format (HLD Target §3.2).
// vite-plugin-dts writes extensionless `.d.ts`. With "type": "module" those are ESM
// declarations, so a CommonJS consumer (`require`, moduleResolution node16/nodenext)
// got ESM types ("masquerading as ESM"), and ESM consumers under node16 cannot follow
// extensionless relative imports. This writes, next to every `x.d.ts`:
//   x.d.ts   relative specifiers → `./y.js`   (ESM, matches the .js build)
//   x.d.cts  relative specifiers → `./y.cjs`  (CJS, matches the .cjs build)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DIST = resolve(import.meta.dirname, '../dist')
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bexport\s+\*\s+from\s*)(['"])(\.{1,2}\/[^'"]*)\2/g

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : name.endsWith('.d.ts') ? [path] : []
  })
}

function rewrite(source, dir, ext) {
  return source.replace(SPECIFIER, (match, lead, quote, spec) => {
    if (/\.(c|m)?js$/.test(spec) || spec.endsWith('.json') || spec.endsWith('.vue')) return match
    const target = resolve(dir, spec)
    if (existsSync(`${target}.d.ts`)) return `${lead}${quote}${spec}${ext}${quote}`
    if (existsSync(join(target, 'index.d.ts'))) return `${lead}${quote}${spec.replace(/\/$/, '')}/index${ext}${quote}`
    return match
  })
}

let count = 0
for (const file of files(DIST)) {
  const source = readFileSync(file, 'utf8')
  const dir = dirname(file)
  // the .d.cts keeps the .d.ts sourcemap: same lines, only the specifiers differ
  writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), rewrite(source, dir, '.cjs'))
  writeFileSync(file, rewrite(source, dir, '.js'))
  count++
}
console.log(`dts-formats: ${count} declaration files → .d.ts (ESM) + .d.cts (CJS)`)
