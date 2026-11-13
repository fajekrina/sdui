// Post-build: publish the Studio stylesheet as dist/builder/studio.css, for apps that
// link it themselves (`mountStudio(el, { stylesheet: 'external' })`) under a strict CSP.
// The source of truth stays src/builder/studio-css.ts (STUDIO_CSS).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/builder/studio-css.ts', import.meta.url), 'utf8')
const match = source.match(/export const STUDIO_CSS = `([\s\S]*?)`/)
if (!match || match[1].includes('${')) throw new Error('STUDIO_CSS must be one plain template literal')
mkdirSync(new URL('../dist/builder/', import.meta.url), { recursive: true })
writeFileSync(new URL('../dist/builder/studio.css', import.meta.url), match[1].trimStart())
console.log('dist/builder/studio.css written')
