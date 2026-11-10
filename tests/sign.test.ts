import { describe, expect, it } from 'vitest'
import {
  decodeEnvelopePayload,
  encodeEnvelopeParts,
  fetchSignedPage,
  isSignedEnvelope,
  signBytes,
  verifyEnvelope,
} from '../src/core/sign'

async function keypair() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { publicKey: pub, privateKey: pair.privateKey }
}

describe('isSignedEnvelope', () => {
  it('detects envelopes', () => {
    expect(isSignedEnvelope({ payload: 'eA==', signature: 'cw==' })).toBe(true)
    expect(isSignedEnvelope({ payload: 'eA==' })).toBe(false)
    expect(isSignedEnvelope(null)).toBe(false)
    expect(isSignedEnvelope('plain')).toBe(false)
  })
})

describe('sign + verify round-trip (Ed25519)', () => {
  it('verifies its own signature and decodes JSON', async () => {
    const { publicKey, privateKey } = await keypair()
    const payload = new TextEncoder().encode(JSON.stringify({ schemaVersion: '1.0', ok: true }))
    const signature = await signBytes(privateKey, payload)
    const { payload: b64p, signature: b64s } = encodeEnvelopeParts({ payload, signature })
    const out = await verifyEnvelope(
      { schemaVersion: '1.0', alg: 'ed25519', payload: b64p, signature: b64s },
      { publicKey }
    )
    expect(decodeEnvelopePayload<{ ok: boolean }>(out)).toEqual({ schemaVersion: '1.0', ok: true })
  })

  it('rejects tampered payloads', async () => {
    const { publicKey, privateKey } = await keypair()
    const payload = new TextEncoder().encode('{"a":1}')
    const signature = await signBytes(privateKey, payload)
    const tampered = new Uint8Array(payload)
    tampered[0] = 'X'.charCodeAt(0)
    const parts = encodeEnvelopeParts({ payload: tampered, signature })
    await expect(
      verifyEnvelope({ alg: 'ed25519', payload: parts.payload, signature: parts.signature }, { publicKey })
    ).rejects.toThrow(/signature invalid/)
  })

  it('rejects unknown algs and missing keys', async () => {
    const { publicKey } = await keypair()
    await expect(
      verifyEnvelope({ alg: 'rsa', payload: 'eA==', signature: 'cw==' }, { publicKey })
    ).rejects.toThrow(/alg/)
    await expect(
      verifyEnvelope({ alg: 'ed25519', payload: 'eA==', signature: 'cw==' }, { publicKey })
    ).rejects.toThrow()
  })

  it('passes unsigned payloads through unless required', async () => {
    const out = await verifyEnvelope('plain-json')
    expect(new TextDecoder().decode(out)).toBe('plain-json')
    await expect(verifyEnvelope('plain-json', { requireSigned: true })).rejects.toThrow(/requireSigned|signed envelope is required|signed envelope required/)
  })

  it('fetchSignedPage verifies envelopes and passes plain JSON through', async () => {
    const { publicKey, privateKey } = await keypair()
    const payload = new TextEncoder().encode(JSON.stringify({ ok: true }))
    const signature = await signBytes(privateKey, payload)
    const parts = encodeEnvelopeParts({ payload, signature })
    const signedRes = { ok: true, status: 200, json: async () => ({ alg: 'ed25519', ...parts }) }
    const got = await fetchSignedPage<{ ok: boolean }>('https://x/signed', {
      fetchImpl: (async () => signedRes) as unknown as typeof fetch,
      publicKey,
    })
    expect(got).toEqual({ page: { ok: true }, signed: true })

    const plainRes = { ok: true, status: 200, json: async () => ({ ok: true }) }
    const plain = await fetchSignedPage<{ ok: boolean }>('https://x/plain', {
      fetchImpl: (async () => plainRes) as unknown as typeof fetch,
    })
    expect(plain).toEqual({ page: { ok: true }, signed: false })
    await expect(
      fetchSignedPage('https://x/plain', { fetchImpl: (async () => plainRes) as unknown as typeof fetch, requireSigned: true })
    ).rejects.toThrow(/unsigned/)
    await expect(fetchSignedPage('https://x/500', {
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch,
      publicKey,
    })).rejects.toThrow(/failed 500/)
  })
})
