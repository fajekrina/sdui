/**
 * Fajrina SDUI — Loader: network + ETag revalidation + signature verification
 * + last-good cache, all through ports. Never throws: failures become an error
 * page plus SduiErrors so the caller always has something to render.
 *
 *   cache hit  → GET If-None-Match: etag → 304 → cached body
 *   200        → verify (if signed / required) → validate → store if clean
 *   network ✗  → cached body (re-verified + re-validated) → else error page ('network')
 *   4xx / 5xx  → 5xx with cache: cached body; else error page ('http' + status + serverCode)
 */

import type { UniversalPageConfig } from './types'
import type { ResolvedPorts } from './ports'
import { validateData, toErrorPage, errorKindOf, type SduiBounds, type SduiError, type SduiPolicy } from './validate'
import { isSignedEnvelope, verifyEnvelope, decodeEnvelopePayload } from './sign'
import { cacheKey } from './cache'

export interface VerifyOptions {
  /** key id → raw 32-byte Ed25519 public key (backend GET /client/signing-keys) */
  publicKeys: Record<string, Uint8Array<ArrayBuffer>>
  /** true = unsigned payloads are rejected (fail closed) */
  required: boolean
}

export interface PageSource {
  merchantId: string
  pageKey: string
  signal?: AbortSignal
}

export interface LoadResult {
  page: UniversalPageConfig
  source: 'fresh' | 'not-modified' | 'cache' | 'error'
  errors: SduiError[]
  etag?: string
  signed: boolean
}

interface CacheEntry { v: 2; body: unknown; etag?: string }

export interface LoaderOptions {
  ports: ResolvedPorts
  verify?: VerifyOptions
  bounds?: SduiBounds
  policy?: SduiPolicy
}

async function readCache(ports: ResolvedPorts, key: string): Promise<CacheEntry | null> {
  try {
    const raw = await ports.storage.get(key)
    if (raw == null) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && (parsed as CacheEntry).v === 2) return parsed as CacheEntry
    return { v: 2, body: parsed } // 0.2.x entry: plain page, no etag
  } catch {
    return null
  }
}

async function decode(body: unknown, opts: LoaderOptions): Promise<{ page: UniversalPageConfig; signed: boolean }> {
  if (isSignedEnvelope(body)) {
    const keys = opts.verify?.publicKeys ?? {}
    const ids = Object.keys(keys)
    const key = body.keyId ? keys[body.keyId] : ids.length === 1 ? keys[ids[0]!] : undefined
    if (!key) throw new Error(body.keyId ? `unknown signing key '${body.keyId}'` : 'no public key to verify the signed envelope')
    const bytes = await verifyEnvelope(body, { publicKey: key, requireSigned: true, crypto: opts.ports.crypto })
    return { page: decodeEnvelopePayload<UniversalPageConfig>(bytes), signed: true }
  }
  if (opts.verify?.required) throw new Error('signed envelope required but payload is unsigned')
  if (!body || typeof body !== 'object') throw new Error('page body is not a JSON object')
  return { page: body as UniversalPageConfig, signed: false }
}

function failure(message: string, code: SduiError['code'], extra: Pick<SduiError, 'status' | 'serverCode'> = {}): LoadResult {
  const err: SduiError = { code, message, ...extra }
  const page = toErrorPage(message, { kind: errorKindOf(err), code, status: extra.status, serverCode: extra.serverCode })
  return { page, source: 'error', errors: [err], signed: false }
}

export async function loadPage(src: PageSource, opts: LoaderOptions): Promise<LoadResult> {
  const { ports } = opts
  const key = cacheKey(src.merchantId, src.pageKey)
  const cached = await readCache(ports, key)

  const fromBody = async (body: unknown, source: LoadResult['source'], etag?: string): Promise<LoadResult> => {
    try {
      const { page, signed } = await decode(body, opts)
      const errors = validateData(page, { bounds: opts.bounds, policy: opts.policy })
      return { page, source, errors, etag, signed }
    } catch (e) {
      return failure(String((e as Error).message ?? e), 'decode')
    }
  }

  if (!ports.network) {
    if (cached) return fromBody(cached.body, 'cache', cached.etag)
    return failure('no NetworkPort configured (pass ports.network or use @fajekrina/sdui/browser)', 'network')
  }

  let res
  try {
    res = await ports.network.getPage({ merchantId: src.merchantId, pageKey: src.pageKey, etag: cached?.etag, signal: src.signal })
  } catch (e) {
    if (cached) return fromBody(cached.body, 'cache', cached.etag)
    return failure(String((e as Error).message ?? e), 'network')
  }

  if (res.status === 304 && cached) return fromBody(cached.body, 'not-modified', cached.etag)
  if (res.status < 200 || res.status >= 300) {
    if (cached && res.status >= 500) return fromBody(cached.body, 'cache', cached.etag)
    // universal-service error contract: {errorDesc, errorCode, errorMessage}; older servers: {error}
    const b = res.body && typeof res.body === 'object' ? (res.body as Record<string, unknown>) : {}
    const msg = b.errorMessage ?? b.error ?? `HTTP ${res.status}`
    const serverCode = typeof b.errorCode === 'string' && b.errorCode ? b.errorCode : undefined
    return failure(String(msg), 'http', { status: res.status, ...(serverCode ? { serverCode } : {}) })
  }

  const result = await fromBody(res.body, 'fresh', res.etag)
  if (result.source === 'fresh' && result.errors.length === 0) {
    try {
      const entry: CacheEntry = { v: 2, body: res.body, etag: res.etag }
      await ports.storage.set(key, JSON.stringify(entry))
    } catch {
      // best-effort cache write
    }
  }
  return result
}
