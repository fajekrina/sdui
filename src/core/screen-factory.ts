import { SduiError } from './errors'
import { toBytes, type Bytes, type BytesLike } from './bytes'

export type ScreenProvider = (options: { signal?: AbortSignal }) => Promise<BytesLike> | BytesLike

/// The screen registry: a screen key → its JSON bytes (Factory pattern). N
/// screens = N registrations (or one provider shared by all keys), never a class
/// per screen. Sources: inline data, an async provider (the backend), or a
/// fallback provider for keys with no explicit entry.
export class ScreenFactory {
  private readonly providers = new Map<string, ScreenProvider>()
  private fallback?: (key: string, options: { signal?: AbortSignal }) => Promise<BytesLike> | BytesLike

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

  /// Resolve every key without its own entry (e.g. `GET /client/page/{merchant}/{key}`).
  registerFallback(provider: (key: string, options: { signal?: AbortSignal }) => Promise<BytesLike> | BytesLike): this {
    this.fallback = provider
    return this
  }

  /// The JSON for a key, or `SduiError.unknownScreen` if none resolves.
  async data(key: string, options: { signal?: AbortSignal } = {}): Promise<Bytes> {
    const provider = this.providers.get(key)
    if (provider) return toBytes(await provider(options))
    if (this.fallback) return toBytes(await this.fallback(key, options))
    throw SduiError.unknownScreen(key)
  }

  get registeredKeys(): string[] {
    return [...this.providers.keys()].sort()
  }
}
