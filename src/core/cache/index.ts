import { PassthroughCipher, type CacheCipher } from './cipher'
import type { CacheStore } from './store'

/// Cache configuration injected into the engine (Strategy + limits).
export class SduiCache {
  readonly store: CacheStore
  readonly cipher: CacheCipher
  readonly renderCacheLimit: number

  constructor(init: { store: CacheStore; cipher?: CacheCipher; renderCacheLimit?: number }) {
    this.store = init.store
    this.cipher = init.cipher ?? new PassthroughCipher()
    this.renderCacheLimit = init.renderCacheLimit ?? 32
  }
}

/// Storage-safe cache key for `screenKey@version` (no hashing needed: keys are
/// identifiers and versions are opaque tokens; `/` and `..` are escaped away).
export function cacheKey(screenKey: string, version: string): string {
  return `sdui:${encodeURIComponent(screenKey)}@${encodeURIComponent(version)}`
}

export { CacheCoordinator } from './coordinator'
export { Manifest } from './manifest'
export { MemoryCacheStore, type CacheStore } from './store'
export { PassthroughCipher, type CacheCipher } from './cipher'
