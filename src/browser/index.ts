// @fajekrina/sdui/browser — browser implementations of the ports. The only
// module (with ./bridge) that touches window, fetch, WebCrypto and IndexedDB.

import { SduiError } from '../core/errors'
import { concatBytes, toBytes, type Bytes, type BytesLike } from '../core/bytes'
import type { SduiProps, SduiValue } from '../core/value'
import type {
  CacheCipher, CacheStore, NamedRequest, NetworkClient, Navigator, SignatureVerifier, ViewportPort
} from '../ports'

// MARK: - Network

/// How the app bundle maps a request NAME to an endpoint. Payloads only ever
/// name a request; method and path live here (an allow-list in the bundle).
export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /// path under `baseUrl`; `{param}` segments are filled from params (URL-encoded)
  path: string
}

export interface FetchClientOptions {
  baseUrl: string
  endpoints: Record<string, Endpoint>
  /// Called before every request — token pattern B: a short-lived access token
  /// fetched from the host (bridge) and kept only in memory. `refresh: true`
  /// after a 401, so an expired token is replaced once and the request retried.
  getHeaders?: (options: { refresh: boolean }) => Promise<Record<string, string>> | Record<string, string>
  fetchImpl?: typeof fetch
}

/// `NetworkClient` over `fetch`. Unknown request names fail closed
/// (`unknownRequest`); non-2xx becomes `SduiError.http(status, errorMessage, errorCode)`.
export function fetchNetworkClient(options: FetchClientOptions): NetworkClient {
  const base = options.baseUrl.replace(/\/$/, '')
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  return {
    async perform(request: NamedRequest, params: SduiProps, opts = {}): Promise<Bytes> {
      const endpoint = options.endpoints[request.rawValue]
      if (!endpoint) throw SduiError.unknownRequest(request.rawValue)
      const { url, body } = buildRequest(base, endpoint, params)
      const send = async (refresh: boolean) => {
        const headers: Record<string, string> = { Accept: 'application/json', ...(await options.getHeaders?.({ refresh }) ?? {}) }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        // one key per user tap + request: a retried or doubled submit is dropped server-side
        if (opts.idempotencyKey && endpoint.method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey
        return doFetch(url, { method: endpoint.method, headers, body, signal: opts.signal, credentials: 'omit' })
      }
      let response: Response
      try {
        response = await send(false)
        if (response.status === 401 && options.getHeaders) response = await send(true)
      } catch {
        throw SduiError.network(null)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!response.ok) throw httpError(response.status, bytes)
      return bytes
    }
  }
}

/// Fill `{param}` path segments. Fails closed: a missing/empty value, or a dot
/// segment (`.`, `..`, which `encodeURIComponent` leaves intact and a URL parser
/// would resolve to another endpoint), rejects the request before it is sent.
function buildRequest(base: string, endpoint: Endpoint, params: SduiProps): { url: string; body?: string } {
  const rest: Record<string, SduiValue> = { ...params }
  const path = endpoint.path.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => {
    const value = rest[name]
    delete rest[name]
    const text = value === null || value === undefined || typeof value === 'object' ? '' : String(value).trim()
    if (text === '' || text === '.' || text === '..') throw SduiError.schema(`path parameter "${name}" is missing or not allowed`)
    return encodeURIComponent(text)
  })
  if (endpoint.method === 'GET' || endpoint.method === 'DELETE') {
    const query = Object.entries(rest)
      .filter(([, v]) => v !== null && typeof v !== 'object')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return { url: `${base}${path}${query ? `?${query}` : ''}` }
  }
  return { url: `${base}${path}`, body: JSON.stringify(rest) }
}

/// universal-service error contract: `{errorDesc, errorCode, errorMessage}`; older `{error}`.
function httpError(status: number, bytes: Uint8Array): SduiError {
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    const message = typeof body.errorMessage === 'string' ? body.errorMessage : typeof body.error === 'string' ? body.error : undefined
    const code = typeof body.errorCode === 'string' ? body.errorCode : undefined
    return SduiError.http(status, message, code)
  } catch {
    return SduiError.http(status)
  }
}

/// A screen provider for universal-service: `GET {baseUrl}/client/page/{merchantId}/{key}`.
/// Use with `screenFactory.registerFallback(...)`.
export function universalScreenProvider(options: { baseUrl: string; merchantId: string; signed?: boolean; getHeaders?: FetchClientOptions['getHeaders']; fetchImpl?: typeof fetch }) {
  const base = options.baseUrl.replace(/\/$/, '')
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  return async (key: string, opts: { signal?: AbortSignal } = {}): Promise<Bytes> => {
    const url = `${base}/client/page/${encodeURIComponent(options.merchantId)}/${encodeURIComponent(key)}${options.signed ? '?signed=true' : ''}`
    let response: Response
    try {
      response = await doFetch(url, { headers: { Accept: 'application/json', ...(await options.getHeaders?.({ refresh: false }) ?? {}) }, signal: opts.signal })
    } catch {
      throw SduiError.network(null)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (response.status === 404) throw SduiError.unknownScreen(key)
    if (!response.ok) throw httpError(response.status, bytes)
    return bytes
  }
}

// MARK: - Signature verification (WebCrypto Ed25519)

/// Ed25519 verifier over WebCrypto. The 32-byte raw public key is imported (and
/// so validated) once. Where WebCrypto lacks Ed25519 (older WebViews), pass a
/// `SignatureVerifier` backed by a JS implementation such as `@noble/ed25519`.
export async function webCryptoEd25519(publicKey: Uint8Array, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<SignatureVerifier> {
  if (publicKey.length !== 32) throw new TypeError('Ed25519 public key must be 32 bytes')
  const key = await subtle.importKey('raw', new Uint8Array(publicKey), { name: 'Ed25519' }, false, ['verify'])
  return {
    async verify(payload, signature) {
      try {
        return await subtle.verify({ name: 'Ed25519' }, key, new Uint8Array(signature), new Uint8Array(payload))
      } catch {
        return false
      }
    }
  }
}

// MARK: - Cache (IndexedDB + AES-GCM)

/// Persistent, origin-isolated cache in IndexedDB. Only verified screen payloads
/// are stored — never API responses or form values.
export function indexedDbStore(databaseName = 'sdui', factory: IDBFactory = globalThis.indexedDB): CacheStore {
  const storeName = 'screens'
  let db: Promise<IDBDatabase> | undefined
  const open = () => (db ??= new Promise((resolve, reject) => {
    const req = factory.open(databaseName, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(storeName)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const database = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(storeName, mode)
      const req = op(tx.objectStore(storeName))
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  const safe = (key: string) => key.length > 0 && !key.includes('/') && key !== '.' && key !== '..'
  return {
    async data(key) {
      if (!safe(key)) return undefined
      try {
        const value = await run<unknown>('readonly', (s) => s.get(key))
        return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : undefined
      } catch { return undefined }
    },
    async store(data, key) {
      if (!safe(key)) return
      try { await run('readwrite', (s) => s.put(data, key)) } catch { /* best effort */ }
    },
    async remove(key) {
      if (!safe(key)) return
      try { await run('readwrite', (s) => s.delete(key)) } catch { /* best effort */ }
    }
  }
}

/// Opt-in AES-GCM at-rest encryption (`nonce ‖ ciphertext ‖ tag`). Keep the key
/// non-extractable; the host may derive it per install.
export function aesGcmCipher(key: CryptoKey, subtle: SubtleCrypto = globalThis.crypto.subtle): CacheCipher {
  return {
    async seal(plaintext) {
      try {
        const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12))
        const sealed = await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new Uint8Array(plaintext))
        return concatBytes(nonce, new Uint8Array(sealed))
      } catch { throw SduiError.decryptionFailed() }
    },
    async open(ciphertext) {
      try {
        if (ciphertext.length < 28) throw new Error('too short')
        return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: ciphertext.slice(0, 12) }, key, ciphertext.slice(12)))
      } catch { throw SduiError.decryptionFailed() }
    }
  }
}

export function generateAesKey(subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>
}

// MARK: - Navigation + viewport

export interface BrowserNavigatorOptions {
  /// your router; SDUI never guesses URLs
  navigate?: Navigator['navigate']
  /// allow-listed link names → URLs (anything else is ignored)
  links?: Record<string, string>
}

/// `dismiss` → `history.back()`, `openLink` → the allow-listed URL in a new tab.
export function browserNavigator(options: BrowserNavigatorOptions = {}): Navigator {
  return {
    navigate: options.navigate ?? (() => {}),
    dismiss: () => window.history.back(),
    refresh: () => {},
    openLink: (name) => {
      const url = options.links?.[name]
      if (url && /^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
}

/// The window's width, for `screen.variants`.
export function windowViewport(): ViewportPort {
  return {
    width: () => window.innerWidth,
    subscribe(listener) {
      let last = window.innerWidth < 600
      const onResize = () => {
        const compact = window.innerWidth < 600
        if (compact !== last) { last = compact; listener() }
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
  }
}

export interface BrowserPortsOptions {
  baseUrl: string
  merchantId?: string
  endpoints?: Record<string, Endpoint>
  getHeaders?: FetchClientOptions['getHeaders']
  navigate?: Navigator['navigate']
  links?: Record<string, string>
}

/// All browser ports in one call, ready for `createEngine` / `ActionDispatcher`.
export function browserPorts(options: BrowserPortsOptions) {
  return {
    network: fetchNetworkClient({ baseUrl: options.baseUrl, endpoints: options.endpoints ?? {}, getHeaders: options.getHeaders }),
    navigator: browserNavigator({ navigate: options.navigate, links: options.links }),
    viewport: windowViewport(),
    store: indexedDbStore(),
    screenProvider: options.merchantId
      ? universalScreenProvider({ baseUrl: options.baseUrl, merchantId: options.merchantId, getHeaders: options.getHeaders })
      : undefined
  }
}

export function hasBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export { toBytes, type BytesLike }
