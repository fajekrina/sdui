// Ports — every side effect the engine needs, as an injected contract.
//
// The core never touches window/document/localStorage/fetch/crypto. A host fills
// these: `browserPorts()` on the web, `nativeBridgePorts()` inside an Android
// WebView / iOS WKWebView. The defaults here are safe for SSR and tests.

import { SduiError } from '../core/errors'
import type { Bytes } from '../core/bytes'
import type { SduiProps, SduiValue } from '../core/value'
import type { Presentation } from '../core/actions/spec'

export type { CacheStore } from '../core/cache/store'
export { MemoryCacheStore } from '../core/cache/store'
export type { CacheCipher } from '../core/cache/cipher'
export { PassthroughCipher } from '../core/cache/cipher'

// MARK: - Network

/// An allow-listed request name. The JSON `request` string becomes one of these;
/// the app bundle — never the payload — maps it to a method and path.
export class NamedRequest {
  constructor(readonly rawValue: string) {}
  equals(other: NamedRequest): boolean { return other.rawValue === this.rawValue }
  toString(): string { return this.rawValue }
}

/// The networking Strategy: given an allow-listed named request + params, return
/// the response bytes. Failures surface as `SduiError.network` / `SduiError.http`.
export interface NetworkClient {
  /// `idempotencyKey`: unique per user tap (+ request); send it so the backend can
  /// drop duplicates (`Idempotency-Key` header in `fetchNetworkClient`).
  perform(request: NamedRequest, params: SduiProps, options?: { signal?: AbortSignal; idempotencyKey?: string }): Promise<Bytes>
}

/// The default when no client is wired: every request is (correctly) unknown, so
/// an `api` action fails closed to its `onError`.
export class NoNetworkClient implements NetworkClient {
  async perform(request: NamedRequest): Promise<Bytes> {
    throw SduiError.unknownRequest(request.rawValue)
  }
}

// MARK: - Navigation (host effects)

export interface NavigateOptions {
  presentation: Presentation
}

/// The host-effect bridge. Navigation, dismissal, refresh, and link-opening are
/// UI concerns the host owns. `navigate`'s params seed the next screen's data.
export interface Navigator {
  navigate(screen: string, params: SduiProps, options: NavigateOptions): void
  dismiss(): void
  /// Called after the screen reloads itself (hosts may also refresh their chrome).
  refresh(): void
  /// `name` is an allow-listed link name; the host maps it to a URL.
  openLink(name: string): void
}

export const noopNavigator: Navigator = {
  navigate: () => {},
  dismiss: () => {},
  refresh: () => {},
  openLink: () => {}
}

// MARK: - Native host

/// Device capabilities a host exposes as named, allow-listed commands
/// (biometric confirm, share, camera, contacts). The only way a payload reaches
/// the device. The result merges into the data context under the command name.
export interface HostPort {
  native(command: string, params: SduiProps): Promise<SduiValue>
}

/// No host (plain browser, SSR, tests): every command is unsupported → `onError`.
export const noHost: HostPort = {
  async native(command: string) {
    throw SduiError.unknownCommand(command)
  }
}

// MARK: - Signature verification

/// Verifies a detached signature over payload bytes (Strategy). Signing lives
/// server-side and is intentionally not part of the client.
export interface SignatureVerifier {
  verify(payload: Uint8Array, signature: Uint8Array, keyId?: string): Promise<boolean> | boolean
}

/// Pick the verifier by the envelope's `keyId` (key rotation). With a single key,
/// an envelope without `keyId` uses it.
export function keyedVerifier(verifiers: Record<string, SignatureVerifier>): SignatureVerifier {
  const ids = Object.keys(verifiers)
  return {
    async verify(payload, signature, keyId) {
      const id = keyId ?? (ids.length === 1 ? ids[0] : undefined)
      const verifier = id !== undefined ? verifiers[id] : undefined
      return verifier ? verifier.verify(payload, signature, keyId) : false
    }
  }
}

// MARK: - Viewport (variants)

/// The width the screen is laid out in, for `screen.variants`. Hosts that never
/// change width can return a constant.
export interface ViewportPort {
  width(): number
  subscribe?(listener: () => void): () => void
}

export const COMPACT_MAX_WIDTH = 600

// MARK: - Connectivity

/// Whether the network is reachable. Offline, the engine serves the last verified
/// layout without trying the network, and `api` actions / `screen.load` fail fast;
/// back online (`subscribe`), it refreshes the manifest and screens reload their data.
/// Default: always online. Browser implementation: `connectivity()` in `./pwa`.
export interface ConnectivityPort {
  online(): boolean
  subscribe?(listener: (online: boolean) => void): () => void
}

// MARK: - Logger

/// The engine never logs tokens, PII, or `secure` field values.
export interface Logger {
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

export const consoleLogger: Logger = {
  warn: (message, detail) => { detail === undefined ? console.warn(message) : console.warn(message, detail) },
  error: (message, detail) => { detail === undefined ? console.error(message) : console.error(message, detail) }
}

export const silentLogger: Logger = { warn: () => {}, error: () => {} }
