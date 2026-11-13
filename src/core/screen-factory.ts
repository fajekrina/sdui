import { SduiError } from './errors'
import { toBytes, type Bytes, type BytesLike } from './bytes'

/// What a provider is told about the load. `version` is the screen's version from the
/// applied manifest (e.g. `"v17"`), absent when no manifest is known; a provider may put
/// it in the URL so the response is immutable and CDN-cacheable. `etag` is the ETag of the
/// cached entry when the engine revalidates an unversioned screen (HTTP `If-None-Match`).
export interface ScreenProviderOptions {
  signal?: AbortSignal
  version?: string
  etag?: string
}

/// What a provider returns: the bytes; the bytes with their ETag; or — only when it was
/// given an `etag` — `{ notModified: true }` (HTTP 304: keep the cached screen).
export type ScreenProviderResult = BytesLike | { bytes: BytesLike; etag?: string } | { notModified: true }

export type ScreenProvider = (options: ScreenProviderOptions) => Promise<ScreenProviderResult> | ScreenProviderResult

/// A provider result, normalized.
export type ScreenFetch = { bytes: Bytes; etag?: string } | { notModified: true }

/// The screen registry: a screen key → its JSON bytes (Factory pattern). N
/// screens = N registrations (or one provider shared by all keys), never a class
/// per screen. Sources: inline data, an async provider (the backend), or a
/// fallback provider for keys with no explicit entry.
export class ScreenFactory {
  private readonly providers = new Map<string, ScreenProvider>()
  private fallback?: (key: string, options: ScreenProviderOptions) => Promise<ScreenProviderResult> | ScreenProviderResult

  /// Register a key with inline data, or with a provider function.
  register(key: string, source: BytesLike | ScreenProvider): this {
    if (typeof source === 'function') {
      this.providers.set(key, source)
    } else {
      const data = toBytes(source)
      this.providers.set(key, () => data)
    }
    return this
  }

  /// Resolve every key without its own entry (e.g. `specScreenProvider`).
  registerFallback(provider: (key: string, options: ScreenProviderOptions) => Promise<ScreenProviderResult> | ScreenProviderResult): this {
    this.fallback = provider
    return this
  }

  /// The provider's answer for a key, or `SduiError.unknownScreen` if none resolves.
  /// `notModified` is only accepted when an `etag` was passed.
  async resolve(key: string, options: ScreenProviderOptions = {}): Promise<ScreenFetch> {
    const provider = this.providers.get(key)
    const fallback = this.fallback
    if (!provider && !fallback) throw SduiError.unknownScreen(key)
    const result = await (provider ? provider(options) : fallback!(key, options))
    if (typeof result === 'object' && result !== null && 'notModified' in result) {
      if (options.etag === undefined) throw SduiError.decode('provider answered notModified without an etag')
      return { notModified: true }
    }
    if (typeof result === 'object' && result !== null && 'bytes' in result) return { bytes: toBytes(result.bytes), etag: result.etag }
    return { bytes: toBytes(result as BytesLike) }
  }

  /// The JSON for a key, or `SduiError.unknownScreen` if none resolves.
  async data(key: string, options: Omit<ScreenProviderOptions, 'etag'> = {}): Promise<Bytes> {
    return (await this.resolve(key, options) as { bytes: Bytes }).bytes
  }

  get registeredKeys(): string[] {
    return [...this.providers.keys()].sort()
  }
}
