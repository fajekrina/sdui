/**
 * Fajrina SDUI — Optional payload signing (mirrors Murti PayloadSecurity).
 * Disabled by default: unsigned payloads flow exactly as before.
 * When the backend wraps a page in an envelope, verify it before trusting —
 * on every load, including from cache.
 *
 * Envelope shape (backend produces, see SECURITY-VALIDASI-SDUI.md):
 *   { schemaVersion, alg: "ed25519", payload: base64(json), signature: base64 }
 */

import type { CryptoPort } from './ports'

export interface SignedEnvelope {
  schemaVersion?: string
  alg?: string
  /** signing key id (backend `sdui_signing_key.key_id`) */
  keyId?: string
  payload: string
  signature: string
}

export function isSignedEnvelope(value: unknown): value is SignedEnvelope {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.payload === 'string' && typeof obj.signature === 'string'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  if (typeof btoa !== 'undefined') return btoa(binary)
  // Node fallback (Buffer exists where btoa does not)
  const buf = (globalThis as unknown as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer
  if (buf) return buf.from(binary, 'binary').toString('base64')
  throw new Error('no base64 encoder available')
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob !== 'undefined') {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  const buf = (globalThis as unknown as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer
  if (buf) return Uint8Array.from(buf.from(b64, 'base64'))
  throw new Error('no base64 decoder available')
}

async function subtleCrypto(): Promise<SubtleCrypto> {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable in this runtime')
  return subtle
}

/**
 * Verify a signed envelope against a raw 32-byte Ed25519 public key.
 * Returns the decoded payload bytes on success, throws otherwise.
 * Unsigned input with { requireSigned: false } is returned as-is.
 */
export async function verifyEnvelope(
  input: unknown,
  opts: { publicKey?: Uint8Array<ArrayBuffer>; requireSigned?: boolean; crypto?: CryptoPort } = {}
): Promise<Uint8Array<ArrayBuffer>> {
  if (!isSignedEnvelope(input)) {
    if (opts.requireSigned) throw new Error('signed envelope required but payload is unsigned')
    if (typeof input === 'string') {
      const enc = new TextEncoder().encode(input)
      return enc
    }
    return new TextEncoder().encode(JSON.stringify(input ?? null))
  }
  if (input.alg != null && input.alg !== 'ed25519') {
    throw new Error(`unsupported envelope alg '${String(input.alg)}'`)
  }
  if (!opts.publicKey || opts.publicKey.length !== 32) {
    throw new Error('a 32-byte Ed25519 public key is required to verify a signed envelope')
  }
  const payloadBytes = base64ToBytes(input.payload)
  const signature = base64ToBytes(input.signature)
  const ok = opts.crypto
    ? await opts.crypto.verifyEd25519(opts.publicKey, payloadBytes, signature)
    : await webCryptoVerify(opts.publicKey, payloadBytes, signature)
  if (!ok) throw new Error('envelope signature invalid')
  return payloadBytes
}

/** WebCrypto Ed25519 verification (fallback when no CryptoPort is injected). */
export async function webCryptoVerify(publicKey: Uint8Array, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const subtle = await subtleCrypto()
  const key = await subtle.importKey('raw', publicKey as Uint8Array<ArrayBuffer>, { name: 'Ed25519' } as AlgorithmIdentifier, false, ['verify'])
  return subtle.verify('Ed25519' as AlgorithmIdentifier, key, signature as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>)
}

export function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(b64)
}

export function decodeEnvelopePayload<T = unknown>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

/** Sign bytes with an in-memory private key. Primary use: tests and tooling —
 * production signing lives backend-side; the client path is verify-only. */
export async function signBytes(
  privateKey: CryptoKey,
  payload: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = await subtleCrypto()
  return new Uint8Array(await subtle.sign({ name: 'Ed25519' }, privateKey, payload))
}

export function encodeEnvelopeParts(parts: { payload: Uint8Array<ArrayBuffer>; signature: Uint8Array<ArrayBuffer> }): { payload: string; signature: string } {
  return { payload: bytesToBase64(parts.payload), signature: bytesToBase64(parts.signature) }
}

export interface SignedFetchOptions {
  fetchImpl?: typeof fetch
  /** REQUIRED in production: raw 32-byte Ed25519 public key of the backend signer. */
  publicKey?: Uint8Array<ArrayBuffer>;
  /** when true, unsigned responses are rejected instead of parsed */
  requireSigned?: boolean
}

/**
 * Fetch a page that may arrive as a signed envelope (see ?signed=true on the
 * backend client endpoint) or as plain JSON. Signed payloads are verified
 * BEFORE anything is decoded or rendered — byte-identical to what was signed.
 */
/** @deprecated since 0.3 — use createRuntime().load with `verify` + a NetworkPort. Removed in 1.0. */
export async function fetchSignedPage<T = unknown>(
  url: string,
  opts: SignedFetchOptions = {}
): Promise<{ page: T; signed: boolean }> {
  const impl = opts.fetchImpl ?? (globalThis as unknown as { fetch: typeof fetch }).fetch
  const res = await impl(url)
  if (!res.ok) throw new Error(`fetchSignedPage failed ${res.status}`)
  const json = (await res.json()) as unknown
  if (!isSignedEnvelope(json)) {
    if (opts.requireSigned) throw new Error('signed envelope required but payload is unsigned')
    return { page: json as T, signed: false }
  }
  if (!opts.publicKey) {
    throw new Error('a 32-byte Ed25519 public key is required to verify this envelope')
  }
  const payload = await verifyEnvelope(json, { publicKey: opts.publicKey, requireSigned: true })
  return { page: decodeEnvelopePayload<T>(payload), signed: true }
}
