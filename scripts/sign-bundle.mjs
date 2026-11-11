// Sign a web bundle for WebView hosts: writes bundle-manifest.json (an envelope
// over { version, sequence, files: { path: sha256 }, minBridge, minHost }),
// signed with the BUNDLE key — never the payload key. Hosts verify it with
// `verifyBundleManifest` semantics before serving any file.
//
//   node scripts/sign-bundle.mjs <bundleDir> --version 1.4.0 --sequence 42 \
//        --key <pkcs8-ed25519.pem> [--key-id bundle-2026] [--min-bridge 1] [--min-host 1.0.0]
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const [dir, ...rest] = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : fallback
}
if (!dir || !arg('key') || !arg('version') || !arg('sequence')) {
  console.error('usage: sign-bundle.mjs <bundleDir> --version <v> --sequence <n> --key <pem> [--key-id id] [--min-bridge 1] [--min-host 1.0.0]')
  process.exit(2)
}

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const files = {}
for (const path of walk(dir).sort()) {
  const rel = relative(dir, path).split(sep).join('/')
  if (rel === 'bundle-manifest.json') continue
  files[rel] = createHash('sha256').update(readFileSync(path)).digest('hex')
}
const manifest = {
  version: arg('version'),
  sequence: Number(arg('sequence')),
  files,
  minBridge: Number(arg('min-bridge', '1')),
  minHost: arg('min-host', '1.0.0')
}
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v
const payload = Buffer.from(JSON.stringify(sorted(manifest)))
const signature = sign(null, payload, createPrivateKey(readFileSync(arg('key'))))
const envelope = { schemaVersion: '1.1', alg: 'ed25519', payload: payload.toString('base64'), signature: signature.toString('base64') }
if (arg('key-id')) envelope.keyId = arg('key-id')
writeFileSync(join(dir, 'bundle-manifest.json'), JSON.stringify(envelope, null, 2) + '\n')
console.log(`signed ${Object.keys(files).length} file(s), sequence ${manifest.sequence} → ${join(dir, 'bundle-manifest.json')}`)
