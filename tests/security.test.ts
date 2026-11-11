// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  Manifest, MemoryCacheStore, PayloadSecurity, ScreenFactory, ScreenSource, SduiCache, SduiError, CacheCoordinator,
  bytesEqual, cacheKey, concatBytes, createEngine, keyedVerifier, sortedJSONStringify, utf8, type CacheStore, type SduiEvent
} from '../src/core'
import { aesGcmCipher, generateAesKey, indexedDbStore, webCryptoEd25519 } from '../src/browser'
import { Counter, envelopeJSON, signingKey, type SigningKey } from './helpers'

const payloadJSON = utf8('{"schemaVersion":"1.1","screen":{"key":"s","root":{"type":"text"}}}')

describe('Ed25519 (WebCrypto) + PayloadSecurity', () => {
  it('verifies, rejects tampering and the wrong key', async () => {
    const key = await signingKey()
    const attacker = await signingKey()
    const verifier = await webCryptoEd25519(key.publicKey)
    const signature = await key.sign(payloadJSON)
    expect(await verifier.verify(payloadJSON, signature)).toBe(true)
    expect(await verifier.verify(concatBytes(payloadJSON, utf8(' ')), signature)).toBe(false)
    expect(await (await webCryptoEd25519(attacker.publicKey)).verify(payloadJSON, signature)).toBe(false)
    await expect(webCryptoEd25519(new Uint8Array(5))).rejects.toThrow()
  })

  it('signed policy: loads a valid envelope, rejects forged and unsigned payloads', async () => {
    const key = await signingKey()
    const engine = createEngine({ security: PayloadSecurity.signed(await webCryptoEd25519(key.publicKey)) })
    const ok = await engine.load(ScreenSource.inline(envelopeJSON(payloadJSON, await key.sign(payloadJSON))))
    expect(ok.kind).toBe('loaded')
    const forged = utf8('{"schemaVersion":"1.1","screen":{"key":"s","root":{"type":"button","props":{"title":"HACKED"}}}}')
    const bad = await engine.load(ScreenSource.inline(envelopeJSON(forged, await key.sign(payloadJSON))))
    expect(bad.kind === 'failed' && bad.error.kind).toBe('signatureInvalid')
    const unsigned = await engine.load(ScreenSource.inline(payloadJSON))
    expect(unsigned.kind === 'failed' && unsigned.error.kind).toBe('signatureInvalid')
  })

  it('key rotation: the envelope keyId picks the verifier', async () => {
    const k1 = await signingKey()
    const k2 = await signingKey()
    const verifier = keyedVerifier({ k1: await webCryptoEd25519(k1.publicKey), k2: await webCryptoEd25519(k2.publicKey) })
    const engine = createEngine({ security: PayloadSecurity.signed(verifier) })
    expect((await engine.load(ScreenSource.inline(envelopeJSON(payloadJSON, await k2.sign(payloadJSON), 'k2')))).kind).toBe('loaded')
    expect((await engine.load(ScreenSource.inline(envelopeJSON(payloadJSON, await k2.sign(payloadJSON), 'k1')))).kind).toBe('failed')
    expect((await engine.load(ScreenSource.inline(envelopeJSON(payloadJSON, await k2.sign(payloadJSON), 'k9')))).kind).toBe('failed')
  })

  it('development accepts bare payloads and unverified envelopes', async () => {
    const engine = createEngine()
    expect((await engine.load(ScreenSource.inline(payloadJSON))).kind).toBe('loaded')
    expect((await engine.load(ScreenSource.inline(envelopeJSON(payloadJSON, utf8('bogus'))))).kind).toBe('loaded')
  })
})

describe('signed cache tiers', () => {
  const home = (type: string) => utf8(`{"schemaVersion":"1.1","screen":{"key":"home","root":{"type":"${type}"}}}`)

  async function setup(provider: (fetches: Counter, envelope: (type: string, signer?: SigningKey) => Promise<Uint8Array>) => () => Promise<Uint8Array>, store: CacheStore = new MemoryCacheStore()) {
    const key = await signingKey()
    const envelope = async (type: string, signer = key) => envelopeJSON(home(type), await signer.sign(home(type)))
    const fetches = new Counter()
    const factory = new ScreenFactory().register('home', provider(fetches, envelope))
    const engine = createEngine({ screenFactory: factory, security: PayloadSecurity.signed(await webCryptoEd25519(key.publicKey)), cache: new SduiCache({ store }) })
    return { engine, fetches, store, envelope }
  }

  it('disk hit avoids a refetch; a tampered entry is evicted and refetched', async () => {
    const { engine, fetches, store } = await setup((f, env) => async () => { f.bump(); return env('text') })
    await engine.load(ScreenSource.key('home'))
    engine.coordinator!.purgeRenderCache()
    expect((await engine.load(ScreenSource.key('home'))).kind).toBe('loaded')
    expect(fetches.count).toBe(1)
    engine.coordinator!.purgeRenderCache()
    await store.store(utf8('corrupted'), cacheKey('home', 'unversioned'))
    await engine.load(ScreenSource.key('home'))
    expect(fetches.count).toBe(2)
  })

  it('offline serves the re-verified last-good; a forged fresh payload is NOT masked', async () => {
    const offline = await setup((f, env) => async () => { f.bump(); if (f.count === 1) return env('text'); throw SduiError.network(null) })
    await offline.engine.load(ScreenSource.key('home'))
    offline.engine.coordinator!.purgeRenderCache()
    offline.engine.coordinator!.apply(new Manifest(1, { home: 'v2' }))
    const served = await offline.engine.load(ScreenSource.key('home'))
    expect(served.kind === 'loaded' && served.origin).toBe('offline')

    const attacker = await signingKey()
    const forged = await setup((f, env) => async () => { f.bump(); return f.count === 1 ? env('text') : env('text', attacker) })
    await forged.engine.load(ScreenSource.key('home'))
    forged.engine.coordinator!.purgeRenderCache()
    forged.engine.coordinator!.apply(new Manifest(1, { home: 'v2' }))
    expect((await forged.engine.load(ScreenSource.key('home'))).kind).toBe('failed')
  })

  it('an http 4xx is not a transport failure: no last-good fallback', async () => {
    const { engine } = await setup((f, env) => async () => { f.bump(); if (f.count === 1) return env('text'); throw SduiError.http(404) })
    await engine.load(ScreenSource.key('home'))
    engine.coordinator!.purgeRenderCache()
    engine.coordinator!.apply(new Manifest(1, { home: 'v2' }))
    const state = await engine.load(ScreenSource.key('home'))
    expect(state.kind === 'failed' && state.error.status).toBe(404)
  })

  it('works over IndexedDB with AES-GCM at rest', async () => {
    const cipher = aesGcmCipher(await generateAesKey())
    const store = indexedDbStore(`sdui-${crypto.randomUUID()}`)
    const key = await signingKey()
    const env = envelopeJSON(home('text'), await key.sign(home('text')))
    const fetches = new Counter()
    const engine = createEngine({
      screenFactory: new ScreenFactory().register('home', () => { fetches.bump(); return env }),
      security: PayloadSecurity.signed(await webCryptoEd25519(key.publicKey)),
      cache: new SduiCache({ store, cipher })
    })
    await engine.load(ScreenSource.key('home'))
    const sealed = (await store.data(cacheKey('home', 'unversioned')))!
    expect(bytesEqual(sealed, env)).toBe(false)              // encrypted at rest
    engine.coordinator!.purgeRenderCache()
    expect((await engine.load(ScreenSource.key('home'))).kind).toBe('loaded')
    expect(fetches.count).toBe(1)
    expect(await store.data('../escape')).toBeUndefined()
  })
})

describe('manifest anti-rollback', () => {
  it('the coordinator rejects an older sequence', () => {
    const c = new CacheCoordinator(8)
    expect(c.apply(new Manifest(5, { home: 'v5' }))).toBe(true)
    expect(c.apply(new Manifest(4, { home: 'v4' }))).toBe(false)
    expect(c.version('home')).toBe('v5')
  })

  it('refreshManifest verifies, applies, rejects forgeries and downgrades (reported)', async () => {
    const key = await signingKey()
    const attacker = await signingKey()
    const events: SduiEvent[] = []
    const queue: Array<{ seq: number; signer: SigningKey }> = [{ seq: 7, signer: key }, { seq: 5, signer: key }, { seq: 9, signer: attacker }]
    const engine = createEngine({
      security: PayloadSecurity.signed(await webCryptoEd25519(key.publicKey)),
      cache: new SduiCache({ store: new MemoryCacheStore() }),
      onEvent: (e) => events.push(e),
      manifestLoader: async () => {
        const { seq, signer } = queue.shift()!
        const body = utf8(sortedJSONStringify(new Manifest(seq, { home: `v${seq}` })))
        return envelopeJSON(body, await signer.sign(body))
      }
    })
    await engine.refreshManifest()
    expect(engine.coordinator!.version('home')).toBe('v7')
    await engine.refreshManifest()                                   // seq 5: validly signed, older → rejected
    expect(engine.coordinator!.version('home')).toBe('v7')
    expect(events.some((e) => e.type === 'rollback_rejected')).toBe(true)
    await expect(engine.refreshManifest()).rejects.toBeInstanceOf(SduiError)   // forged
    expect(engine.coordinator!.version('home')).toBe('v7')
  })
})
