// Bundle-size gate (CI). Each public entry is bundled and minified with esbuild
// (what a consumer's bundler ships, tree-shaken), then gzipped — the total an app
// pays when it imports that entry. Fails when an entry exceeds its budget.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'vue']
const BUDGETS_KB = {
  'src/core/index.ts': 18,      // everything the engine exports
  'src/react/index.ts': 3,      // <SduiScreen>; the engine comes from the app
  'src/vue/index.ts': 3,
  'src/vanilla/index.ts': 3,
  'src/browser/index.ts': 4,
  'src/bridge/index.ts': 5
}

async function gzipKB(entry, external) {
  const result = await build({
    entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false,
    platform: 'browser', target: 'es2022', external, logLevel: 'silent', jsx: 'automatic'
  })
  return gzipSync(Buffer.from(result.outputFiles[0].contents)).length / 1024
}

let failed = false
for (const [entry, budget] of Object.entries(BUDGETS_KB)) {
  const kb = await gzipKB(entry, EXTERNAL)
  const ok = kb <= budget
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${entry.padEnd(22)} ${kb.toFixed(1).padStart(5)} KB gzip, minified (budget ${budget} KB)`)
}
process.exit(failed ? 1 : 0)
