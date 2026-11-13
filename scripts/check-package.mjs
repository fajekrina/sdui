// Package gate (HLD Target §1.3 / §3.2): the PACKED tarball resolves for real consumers.
// Packs the package, installs it into a throwaway project, and typechecks a CommonJS
// (`.cts`, require) and an ESM (`.mts`, import) consumer with moduleResolution node16,
// strict, skipLibCheck OFF — so the .d.ts / .d.cts trees and every export are checked.
// Run after `npm run build`. (publint runs separately in CI.)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc')
const dir = mkdtempSync(join(tmpdir(), 'sdui-consumer-'))
const npm = (args) => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: dir, stdio: 'pipe', shell: process.platform === 'win32' })

try {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--pack-destination', dir], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'commonjs' }))
  npm(['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', '--workspaces=false', `./${tgz}`])

  const imports = `
import { createEngine, SduiBounds, type ConnectivityPort, type ScreenProviderResult } from '@fajekrina/sdui'
import { specScreenProvider, specManifestLoader, fetchNetworkClient } from '@fajekrina/sdui/browser'
import { connectivity, onServiceWorkerUpdate } from '@fajekrina/sdui/pwa'
import { EditorDocument, mountStudio, diff, type StudioCatalog } from '@fajekrina/sdui/builder'
import { MESSAGES_ID } from '@fajekrina/sdui/i18n'
import { mount } from '@fajekrina/sdui/vanilla'
import { nativeBridgePorts } from '@fajekrina/sdui/bridge'
import { fromUniversal } from '@fajekrina/sdui/compat'
const port: ConnectivityPort = connectivity()
const notModified: ScreenProviderResult = { notModified: true }
const catalog: StudioCatalog = { assets: ['logo'] }
const engine = createEngine({ connectivity: port, maxEnvelopeBytes: 1024,
  screenFactory: specScreenProvider({ basePath: '/s', merchantId: 'm' }),
  manifestLoader: specManifestLoader({ basePath: '/s', merchantId: 'm' }), messages: MESSAGES_ID })
const depth: number = SduiBounds.default.maxDepth
export { engine, notModified, catalog, depth, fetchNetworkClient, onServiceWorkerUpdate, EditorDocument, mountStudio, diff, mount, nativeBridgePorts, fromUniversal }
`
  writeFileSync(join(dir, 'cjs.cts'), `${imports}\nimport bounds = require('@fajekrina/sdui/spec/bounds.json')\nexport const fromJson: number = bounds.maxDepth\n`)
  writeFileSync(join(dir, 'esm.mts'), imports)
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'node16', moduleResolution: 'node16', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true, skipLibCheck: false, resolveJsonModule: true, noEmit: true, types: []
    },
    files: ['cjs.cts', 'esm.mts']
  }))
  execFileSync(process.execPath, [tsc, '-p', dir], { stdio: 'inherit' })
  console.log('check-package: ok — CJS (.cts) and ESM (.mts) consumers typecheck against the packed tarball')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
