/**
 * Fajrina SDUI — Ports (injected side effects).
 *
 * The core never touches window/document/localStorage/fetch/crypto directly.
 * Everything effectful goes through these contracts; `@fajekrina/sdui/browser`
 * provides browser implementations, and the defaults below are safe for SSR
 * and tests (memory storage, no-op navigation/events, console logger).
 */

export interface StoragePort {
  get(key: string): string | null | Promise<string | null>
  set(key: string, value: string): void | Promise<void>
  remove(key: string): void | Promise<void>
}

export interface PageRequest {
  merchantId: string
  pageKey: string
  /** last known ETag (release content hash) → If-None-Match */
  etag?: string
  signal?: AbortSignal
}

export interface PageResponse {
  status: number
  /** parsed JSON body: a page, or a signed envelope */
  body?: unknown
  etag?: string
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  body?: unknown
  signal?: AbortSignal
}

export interface NetworkPort {
  getPage(req: PageRequest): Promise<PageResponse>
  /** used by the `api` action only; the URL is checked against policy before this is called */
  request?(req: HttpRequest): Promise<{ status: number; body?: unknown }>
}

export interface CryptoPort {
  verifyEd25519(publicKey: Uint8Array, data: Uint8Array, signature: Uint8Array): Promise<boolean>
}

export interface NavigationPort {
  /** app router — SDUI never guesses URLs, so the default is a no-op (onAction still fires) */
  navigate(target: string, params?: Record<string, unknown>): void
  back(): void
  /** called only after the href passed the domain allow-list */
  openExternal(href: string): void
}

export interface EventPort {
  /** called only after the event name passed the allow-list */
  emit(name: string, detail?: Record<string, unknown>): void
}

export interface LoggerPort {
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

export interface SduiPorts {
  storage?: StoragePort
  network?: NetworkPort
  crypto?: CryptoPort
  navigation?: NavigationPort
  events?: EventPort
  logger?: LoggerPort
}

export interface ResolvedPorts {
  storage: StoragePort
  network?: NetworkPort
  crypto?: CryptoPort
  navigation: NavigationPort
  events: EventPort
  logger: LoggerPort
}

export function memoryStorage(): StoragePort {
  const map = new Map<string, string>()
  return {
    get: (key) => (map.has(key) ? map.get(key)! : null),
    set: (key, value) => { map.set(key, value) },
    remove: (key) => { map.delete(key) }
  }
}

export const noopNavigation: NavigationPort = {
  navigate: () => {},
  back: () => {},
  openExternal: () => {}
}

export const noopEvents: EventPort = { emit: () => {} }

export const consoleLogger: LoggerPort = {
  warn: (message, detail) => { detail === undefined ? console.warn(message) : console.warn(message, detail) },
  error: (message, detail) => { detail === undefined ? console.error(message) : console.error(message, detail) }
}

/** Fill missing ports with SSR/test-safe defaults. Per-port override, never all-or-nothing. */
export function resolvePorts(ports?: SduiPorts, fallback?: SduiPorts): ResolvedPorts {
  return {
    storage: ports?.storage ?? fallback?.storage ?? memoryStorage(),
    network: ports?.network ?? fallback?.network,
    crypto: ports?.crypto ?? fallback?.crypto,
    navigation: { ...noopNavigation, ...(fallback?.navigation ?? {}), ...(ports?.navigation ?? {}) },
    events: ports?.events ?? fallback?.events ?? noopEvents,
    logger: ports?.logger ?? fallback?.logger ?? consoleLogger
  }
}
