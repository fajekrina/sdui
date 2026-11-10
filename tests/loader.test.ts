import { describe, expect, it, vi } from 'vitest'
import { loadPage } from '../src/core/loader'
import { resolvePorts, memoryStorage, type NetworkPort, type PageResponse } from '../src/core/ports'
import { encodeEnvelopeParts, signBytes } from '../src/core/sign'
import { cacheKey } from '../src/core/cache'

const page = { pageId: 'm-home', pageKey: 'home', merchantId: 'm', layout: { components: [{ id: 'h', type: 'Heading', props: { content: 'Hi' } }] } }
const src = { merchantId: 'm', pageKey: 'home' }
const quiet = { warn: () => {}, error: () => {} }

function net(...responses: Array<PageResponse | Error>): NetworkPort & { getPage: ReturnType<typeof vi.fn> } {
  const getPage = vi.fn(async () => {
    const r = responses.shift()
    if (r instanceof Error) throw r
    return r!
  })
  return { getPage }
}

describe('loader', () => {
  it('stores a clean page with its ETag and revalidates with If-None-Match', async () => {
    const storage = memoryStorage()
    const network = net({ status: 200, body: page, etag: 'abc' }, { status: 304 })
    const ports = resolvePorts({ storage, network, logger: quiet })
    const first = await loadPage(src, { ports })
    expect(first).toMatchObject({ source: 'fresh', etag: 'abc', errors: [] })
    const second = await loadPage(src, { ports })
    expect(network.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ etag: 'abc' }))
    expect(second.source).toBe('not-modified')
    expect(second.page).toEqual(page)
  })

  it('serves last-good on network failure, error page without cache', async () => {
    const storage = memoryStorage()
    await storage.set(cacheKey('m', 'home'), JSON.stringify(page)) // 0.2.x cache entry
    const ok = await loadPage(src, { ports: resolvePorts({ storage, network: net(new Error('offline')), logger: quiet }) })
    expect(ok.source).toBe('cache')
    const bad = await loadPage(src, { ports: resolvePorts({ network: net(new Error('offline')), logger: quiet }) })
    expect(bad.source).toBe('error')
    expect(bad.errors[0]?.code).toBe('network')
  })

  it('maps server rejections to code http with status + backend errorCode', async () => {
    const notFound = await loadPage(src, { ports: resolvePorts({ network: net({ status: 404, body: { errorDesc: 'Not Found', errorCode: 'SDUI-002', errorMessage: 'page m/home not found' } }), logger: quiet }) })
    expect(notFound.source).toBe('error')
    expect(notFound.errors[0]).toEqual({ code: 'http', message: 'page m/home not found', status: 404, serverCode: 'SDUI-002' })
    expect(notFound.page.layout?.title).toBe('Not Found')
    expect(notFound.page.error).toEqual({ kind: 'notFound', code: 'http', status: 404, serverCode: 'SDUI-002' })

    const down = await loadPage(src, { ports: resolvePorts({ network: net({ status: 500, body: { errorCode: 'SDUI-099', errorMessage: 'boom' } }), logger: quiet }) })
    expect(down.errors[0]?.status).toBe(500)
    expect(down.page.layout?.title).toBe('Service Unavailable')

    const legacy = await loadPage(src, { ports: resolvePorts({ network: net({ status: 403, body: { error: 'nope' } }), logger: quiet }) })
    expect(legacy.errors[0]).toEqual({ code: 'http', message: 'nope', status: 403 })
    expect(legacy.page.layout?.title).toBe('Access Denied')
  })

  it('titles transport and decode failures distinctly', async () => {
    const offline = await loadPage(src, { ports: resolvePorts({ network: net(new Error('offline')), logger: quiet }) })
    expect(offline.page.layout?.title).toBe('Offline')
    const garbage = await loadPage(src, { ports: resolvePorts({ network: net({ status: 200, body: 'not json' }), logger: quiet }) })
    expect(garbage.errors[0]?.code).toBe('decode')
    expect(garbage.page.layout?.title).toBe('Invalid Page')
  })

  describe('signed envelopes', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' } as AlgorithmIdentifier, true, ['sign', 'verify']) as CryptoKeyPair
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const bytes = new TextEncoder().encode(JSON.stringify(page))
    const parts = encodeEnvelopeParts({ payload: bytes, signature: await signBytes(pair.privateKey, bytes) })
    const envelope = { schemaVersion: '1.0', alg: 'ed25519', keyId: 'k1', ...parts }
    const verify = { publicKeys: { k1: pub }, required: true }

    it('verifies by key id', async () => {
      const r = await loadPage(src, { ports: resolvePorts({ network: net({ status: 200, body: envelope }), logger: quiet }), verify })
      expect(r).toMatchObject({ source: 'fresh', signed: true })
      expect(r.page).toEqual(page)
    })

    it('rejects unsigned payloads when required', async () => {
      const r = await loadPage(src, { ports: resolvePorts({ network: net({ status: 200, body: page }), logger: quiet }), verify })
      expect(r.source).toBe('error')
    })

    it('re-verifies cached envelopes (tampered cache is rejected)', async () => {
      const storage = memoryStorage()
      const tampered = { ...envelope, payload: btoa(JSON.stringify({ ...page, pageKey: 'evil' })) }
      await storage.set(cacheKey('m', 'home'), JSON.stringify({ v: 2, body: tampered }))
      const r = await loadPage(src, { ports: resolvePorts({ storage, network: net(new Error('offline')), logger: quiet }), verify })
      expect(r.source).toBe('error')
      expect(r.errors[0]?.message).toMatch(/signature invalid/)
    })
  })
})
