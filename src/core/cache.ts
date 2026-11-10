/**
 * Fajrina SDUI — Last-good page cache (one-tier version of Murti's cache).
 * On fetch success the payload is stored (only if it validates clean);
 * on fetch failure the last-good payload is served instead of an error page.
 * Storage defaults to localStorage with an in-memory fallback, so the
 * helper is safe in SSR/test runtimes without DOM storage.
 */

import { validateLayout } from './validate'
import { normalizeToLayout } from './types'
import type { UniversalPageConfig } from './types'

export interface PageCacheStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function memoryStore(): PageCacheStore {
  const map = new Map<string, string>()
  return {
    get: (key) => (map.has(key) ? map.get(key)! : null),
    set: (key, value) => { map.set(key, value) },
    remove: (key) => { map.delete(key) },
  }
}

function browserStore(): PageCacheStore | null {
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage
    if (!ls) return null
    return {
      get: (key) => ls.getItem(key),
      set: (key, value) => ls.setItem(key, value),
      remove: (key) => ls.removeItem(key),
    }
  } catch {
    return null
  }
}

export function cacheKey(merchantId: string, pageKey: string): string {
  return `fajrina-page:${merchantId}:${pageKey}`
}

/**
 * @deprecated since 0.3 — use createRuntime().load(), which adds ETag
 * revalidation and signature re-verification of cached payloads. Removed in 1.0.
 *
 * Load a published page with a last-good fallback. Returns the payload plus
 * where it came from ('fresh' | 'cache'). Throws only when both network and
 * cache miss — the caller then renders toErrorPage as before.
 */
export async function loadPageWithCache(
  fetchPage: (merchantId: string, pageKey: string) => Promise<UniversalPageConfig>,
  merchantId: string,
  pageKey: string,
  store?: PageCacheStore
): Promise<{ page: UniversalPageConfig; source: 'fresh' | 'cache' }> {
  const storage = store ?? browserStore() ?? memoryStore()
  const key = cacheKey(merchantId, pageKey)
  try {
    const page = await fetchPage(merchantId, pageKey)
    if (validateLayout(normalizeToLayout(page)).length === 0) {
      try {
        storage.set(key, JSON.stringify(page))
      } catch {
        // best-effort cache write; a fresh payload is still returned
      }
    }
    return { page, source: 'fresh' }
  } catch (networkError) {
    let raw: string | null = null
    try {
      raw = storage.get(key)
    } catch {
      raw = null
    }
    if (raw != null) {
      try {
        return { page: JSON.parse(raw) as UniversalPageConfig, source: 'cache' }
      } catch {
        // fall through to the network error below
      }
    }
    throw networkError
  }
}
