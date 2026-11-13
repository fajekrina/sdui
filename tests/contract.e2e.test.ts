// @vitest-environment node
// F1 gate (HLD Target): the package against a REAL universal-service in `signed` mode.
// Skipped unless SDUI_E2E_BASE_URL is set, e.g.
//   SDUI_E2E_BASE_URL=http://localhost:8090/universal/v1 npm run test:contract
// The backend must run with sdui.signing.enabled=true (see universal-service HANDOFF.md).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { specManifestLoader, specScreenProvider, webCryptoEd25519 } from '../src/browser'
import { MemoryCacheStore, PayloadSecurity, ScreenSource, SduiCache, createEngine, keyedVerifier } from '../src/core'
import { ROOT } from './helpers'

const BASE = process.env.SDUI_E2E_BASE_URL?.replace(/\/$/, '')
const MERCHANT = process.env.SDUI_E2E_MERCHANT ?? 'merchant_demo'

const json = async (res: Response) => {
  const body = await res.json() as Record<string, unknown>
  return (body.data ?? body) as Record<string, unknown>
}

describe.skipIf(!BASE)('contract: @fajekrina/sdui ⇄ universal-service (signed)', () => {
  const delivery = () => ({ basePath: `${BASE}/client`, merchantId: MERCHANT, credentials: 'omit' as const })

  async function engineWith(fetchImpl: typeof fetch = fetch) {
    const keys = (await json(await fetch(`${BASE}/client/signing-keys`))).keys as Array<{ keyId: string; publicKey: string; status: string }>
    const verifiers = Object.fromEntries(await Promise.all(keys.map(async (k) =>
      [k.keyId, await webCryptoEd25519(new Uint8Array(Buffer.from(k.publicKey, 'base64')))] as const)))
    const urls: string[] = []
    const tracking: typeof fetch = (input, init) => { urls.push(String(input)); return fetchImpl(input, init) }
    const engine = createEngine({
      security: PayloadSecurity.signed(keyedVerifier(verifiers)),
      screenFactory: specScreenProvider({ ...delivery(), fetchImpl: tracking }),
      manifestLoader: specManifestLoader({ ...delivery(), fetchImpl: tracking }),
      cache: new SduiCache({ store: new MemoryCacheStore() })
    })
    return { engine, urls }
  }

  it('every screen of the signed manifest loads from its versioned URL', async () => {
    const { engine, urls } = await engineWith()
    await engine.refreshManifest()
    const manifest = await json(await fetch(`${BASE}/client/manifest/${MERCHANT}?signed=false`))
    const screens = manifest.screens as Record<string, string>
    expect(Object.keys(screens).length).toBeGreaterThan(0)
    for (const [key, version] of Object.entries(screens)) {
      const state = await engine.load(ScreenSource.key(key))
      expect(state, key).toMatchObject({ kind: 'loaded', origin: 'network' })
      expect(urls).toContain(`${BASE}/client/screens/${MERCHANT}/${key}/${version}`)
    }
  })

  it('a published fixture reaches the client at its new version', async () => {
    const key = `contract${Date.now()}`
    const fixture = JSON.parse(readFileSync(resolve(ROOT, 'spec/fixtures/valid/dashboard.json'), 'utf8'))
    fixture.screen.key = key
    const merchant = `${BASE}/merchant/screens/${MERCHANT}/${key}`
    const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    expect((await post(merchant, { payload: fixture })).status).toBe(200)
    expect((await post(`${merchant}/publish`)).status).toBe(200)

    const { engine, urls } = await engineWith()
    await engine.refreshManifest()
    expect(await engine.load(ScreenSource.key(key))).toMatchObject({ kind: 'loaded' })
    expect(urls).toContain(`${BASE}/client/screens/${MERCHANT}/${key}/v1`)
  })

  it('a tampered envelope is rejected (fail-closed)', async () => {
    const tamper: typeof fetch = async (input, init) => {
      const res = await fetch(input, init)
      if (!String(input).includes('/screens/')) return res
      const env = await res.json() as { payload: string }
      const bytes = Buffer.from(env.payload, 'base64')
      bytes[bytes.length - 3] ^= 1
      return new Response(JSON.stringify({ ...env, payload: bytes.toString('base64') }), { status: 200 })
    }
    const { engine } = await engineWith(tamper)
    await engine.refreshManifest()
    const state = await engine.load(ScreenSource.key('home'))
    expect(state.kind).toBe('failed')
  })
})
