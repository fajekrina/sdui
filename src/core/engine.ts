import { ActionDispatcher } from './actions/dispatcher'
import { SduiError } from './errors'
import { canonical } from './actions/spec'
import { MESSAGES_EN, type FieldMessages } from './patterns'
import { SduiPayload, SduiEnvelope, parseJSON, type ScreenSpec } from './payload'
import { SchemaValidator } from './validator'
import { PayloadSecurity } from './security'
import { Manifest } from './cache/manifest'
import { CacheCoordinator } from './cache/coordinator'
import { cacheKey, type SduiCache } from './cache'
import { toBytes, type Bytes, type BytesLike } from './bytes'
import { ComponentFactory } from './component-factory'
import { ScreenFactory } from './screen-factory'
import { ScreenController } from './screen'
import { consoleLogger, type Logger, type ViewportPort } from '../ports'
import type { SduiEvent } from './events'
import type { SduiValue } from './value'

/// Where a screen's JSON comes from.
export type ScreenSource =
  | { readonly kind: 'key'; readonly key: string }      // a ScreenFactory entry (the backend)
  | { readonly kind: 'named'; readonly name: string }   // a remote source the host resolves — no raw URLs
  | { readonly kind: 'inline'; readonly data: Bytes }   // previews / tests / builder

export const ScreenSource = {
  key(key: string): ScreenSource { return { kind: 'key', key } },
  named(name: string): ScreenSource { return { kind: 'named', name } },
  inline(data: BytesLike | object): ScreenSource {
    const bytes = typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)
      ? toBytes(JSON.stringify(data))
      : toBytes(data as BytesLike)
    return { kind: 'inline', data: bytes }
  },
  /// Stable identity, so state never leaks between screens.
  identity(source: ScreenSource): string {
    switch (source.kind) {
      case 'key': return `key:${source.key}`
      case 'named': return `named:${source.name}`
      case 'inline': return `inline:${source.data.length}:${fnv1a(source.data)}`
    }
  }
}

/// Where a loaded screen came from (observability).
export type LoadOrigin = 'memory' | 'cache' | 'network' | 'offline' | 'inline'

/// The load lifecycle for one screen. Fail-closed: never a blank screen or crash.
export type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly screen: ScreenSpec; readonly origin: LoadOrigin }
  | { readonly kind: 'failed'; readonly error: SduiError }

export const LoadState = {
  loading: { kind: 'loading' } as LoadState,
  loaded(screen: ScreenSpec, origin: LoadOrigin = 'network'): LoadState { return { kind: 'loaded', screen, origin } },
  failed(error: SduiError): LoadState { return { kind: 'failed', error } }
}

export interface EngineInit {
  componentFactory?: ComponentFactory
  screenFactory?: ScreenFactory
  actionDispatcher?: ActionDispatcher
  validator?: SchemaValidator
  security?: PayloadSecurity
  cache?: SduiCache
  /// resolves `ScreenSource.named` (host-owned, allow-listed)
  namedResolver?: (name: string) => Promise<BytesLike>
  /// fetches the signed version manifest
  manifestLoader?: () => Promise<BytesLike>
  /// maps an image `name` to a URL. Default: a RELATIVE path only — absolute
  /// URLs (`https:`, `//host`, `data:` …) are refused, so a payload can't load
  /// images from an arbitrary host. Map names to your CDN here.
  assetURL?: (name: string) => string
  /// localized field-validation messages (default English; `MESSAGES_ID` in `./i18n`)
  messages?: Partial<FieldMessages>
  /// unique ids (idempotency keys). Default: `randomId()` — `crypto.randomUUID()`,
  /// falling back to a v4 UUID from `crypto.getRandomValues` (older WebViews,
  /// non-secure contexts)
  newId?: () => string
  /// layout width, for `screen.variants`
  viewport?: ViewportPort
  /// observability hook
  onEvent?: (event: SduiEvent) => void
  logger?: Logger
  /// debug build: unknown-type markers and error details (default false)
  debug?: boolean
}

/// Holds the component and screen factories, the validator, security, cache and
/// the action dispatcher. `load` fetches a source, verifies its signature,
/// decodes and validates it — it never throws to the caller.
export class SduiEngine {
  readonly componentFactory: ComponentFactory
  readonly screenFactory: ScreenFactory
  readonly actionDispatcher: ActionDispatcher
  readonly validator: SchemaValidator
  readonly security: PayloadSecurity
  readonly cache?: SduiCache
  /// the cache's session state; present exactly when a cache is configured
  readonly coordinator?: CacheCoordinator
  readonly assetURL: (name: string) => string
  readonly viewport?: ViewportPort
  readonly logger: Logger
  readonly debug: boolean
  readonly messages: FieldMessages
  readonly newId: () => string
  private readonly namedResolver?: (name: string) => Promise<BytesLike>
  private readonly manifestLoader?: () => Promise<BytesLike>
  private readonly onEvent?: (event: SduiEvent) => void
  private manifestRestored?: Promise<void>
  private readonly revalidating = new Map<string, Promise<void>>()
  private readonly revalidatedAt = new Map<string, number>()

  constructor(init: EngineInit = {}) {
    this.componentFactory = init.componentFactory ?? ComponentFactory.withBuiltins()
    this.screenFactory = init.screenFactory ?? new ScreenFactory()
    this.actionDispatcher = init.actionDispatcher ?? new ActionDispatcher()
    this.validator = init.validator ?? new SchemaValidator()
    this.logger = init.logger ?? consoleLogger
    this.debug = init.debug ?? false
    if (init.security) {
      this.security = init.security
    } else if (this.debug) {
      // debug build without a policy: unsigned payloads, said out loud
      this.security = PayloadSecurity.insecureDevelopment
      this.logger.warn('[sdui] no PayloadSecurity configured: accepting UNSIGNED payloads (debug only). Pass PayloadSecurity.signed(verifier) for production.')
    } else {
      // release build without a policy: fail closed, never silently insecure
      this.security = PayloadSecurity.signed({ verify: () => false })
      this.logger.error('[sdui] no PayloadSecurity configured: every payload is REJECTED. Pass PayloadSecurity.signed(verifier), or PayloadSecurity.insecureDevelopment explicitly in development.')
    }
    if (init.cache) {
      this.cache = init.cache
      this.coordinator = new CacheCoordinator(init.cache.renderCacheLimit)
    }
    this.namedResolver = init.namedResolver
    this.manifestLoader = init.manifestLoader
    this.assetURL = init.assetURL ?? relativeAssetURL
    this.messages = { ...MESSAGES_EN, ...(init.messages ?? {}) }
    this.newId = init.newId ?? randomId
    this.viewport = init.viewport
    this.onEvent = init.onEvent
  }

  /// Report an observability event (never throws).
  emit(event: SduiEvent): void {
    try { this.onEvent?.(event) } catch { /* observers never break rendering */ }
  }

  /// A controller for one screen: load → render → handle. Adapters bind to it.
  screen(source: ScreenSource, options: { seed?: Record<string, SduiValue> } = {}): ScreenController {
    return new ScreenController(this, source, options.seed ?? {})
  }

  /// Resolve a source to its screen, failing closed on any error. Key sources go
  /// through the cache tiers (render → persistent → fetch, with an offline
  /// last-good fallback); other sources fetch and materialize directly.
  ///
  /// Without a manifest the cached version can't be known to be current, so a
  /// cached screen is served stale-while-revalidate: shown at once, re-fetched in
  /// the background, and `onUpdate` receives the newer screen if it changed.
  async load(source: ScreenSource, options: LoadOptions = {}): Promise<LoadState> {
    const started = Date.now()
    try {
      let state: LoadState
      if (source.kind === 'key' && this.cache && this.coordinator) {
        const { screen, origin } = await this.loadCached(source.key, this.cache, this.coordinator, options)
        state = LoadState.loaded(screen, origin)
      } else {
        state = LoadState.loaded(await this.materialize(await this.sourceData(source, options)), source.kind === 'inline' ? 'inline' : 'network')
      }
      if (state.kind === 'loaded') this.emit({ type: 'screen_loaded', key: state.screen.key, origin: state.origin, ms: Date.now() - started })
      return state
    } catch (error) {
      const failure = error instanceof SduiError ? error : SduiError.decode(error instanceof Error ? error.message : String(error))
      this.emit({ type: 'validation_failed', source: ScreenSource.identity(source), error: failure.kind, message: failure.message })
      return LoadState.failed(failure)
    }
  }

  /// Fetch the signed manifest, verify it, and apply it. An older `sequence` is
  /// rejected (anti-rollback) and reported, never applied.
  async refreshManifest(): Promise<void> {
    const cache = this.cache
    if (!this.coordinator || !this.manifestLoader || !cache) return
    await this.restoreManifest()
    const raw = toBytes(await this.manifestLoader())
    const manifest = Manifest.fromJSON(await this.unwrap(raw))   // verify signature
    if (!this.coordinator.apply(manifest)) {
      this.emit({ type: 'rollback_rejected', sequence: manifest.sequence })
      return
    }
    // persist the applied manifest: the highest sequence survives a restart
    const sealed = await Promise.resolve().then(() => cache.cipher.seal(raw)).catch(() => undefined)
    if (sealed) await cache.store.store(sealed, MANIFEST_KEY)
  }

  /// Re-apply the last persisted manifest (re-verified) once per engine, so the
  /// anti-rollback floor and the screen versions survive a restart.
  private restoreManifest(): Promise<void> {
    this.manifestRestored ??= (async () => {
      const cache = this.cache
      if (!cache || !this.coordinator) return
      const sealed = await cache.store.data(MANIFEST_KEY)
      if (!sealed) return
      try {
        const manifest = Manifest.fromJSON(await this.unwrap(await cache.cipher.open(sealed)))
        this.coordinator.apply(manifest)
      } catch {
        await cache.store.remove(MANIFEST_KEY)   // tampered: drop it rather than trust it
      }
    })()
    return this.manifestRestored
  }

  /// Warm the cache for the given screen keys.
  async prefetch(screenKeys: string[]): Promise<void> {
    await Promise.all(screenKeys.map((key) => this.load(ScreenSource.key(key))))
  }

  /// Verify (per policy) → decode → validate a payload. Used by `load`, and by
  /// tools (the builder) that need the same checks.
  async materialize(rawBytes: Uint8Array): Promise<ScreenSpec> {
    const payload = SduiPayload.fromJSON(await this.unwrap(rawBytes))
    this.validator.validate(payload)
    return payload.screen
  }

  private async loadCached(screenKey: string, cache: SduiCache, coordinator: CacheCoordinator, options: LoadOptions): Promise<{ screen: ScreenSpec; origin: LoadOrigin }> {
    await this.restoreManifest()
    const known = coordinator.version(screenKey)
    const version = known ?? 'unversioned'
    const key = cacheKey(screenKey, version)

    const rendered = coordinator.renderCached(key)                                     // memory tier
    if (rendered) {
      if (known === undefined) this.revalidate(screenKey, key, rendered, cache, coordinator, options, REVALIDATE_MEMORY_MS)
      return { screen: rendered, origin: 'memory' }
    }

    const sealed = await cache.store.data(key)                                         // persistent tier
    if (sealed) {
      const screen = await this.materializeSealed(sealed, cache).catch(() => undefined) // re-verify
      if (screen) {
        coordinator.storeRender(screen, key)
        coordinator.markGood(screenKey, version)
        if (known === undefined) this.revalidate(screenKey, key, screen, cache, coordinator, options, 0)
        return { screen, origin: 'cache' }
      }
      await cache.store.remove(key)                                                    // tampered → evict
    }

    // Fetch. A TRANSPORT failure falls back to last-good (re-verified, fail-closed);
    // a verification/validation failure of fresh bytes surfaces instead of being masked.
    let raw: Bytes
    try {
      raw = await this.screenFactory.data(screenKey, options)
    } catch (error) {
      const good = coordinator.lastGoodVersion(screenKey)
      if (good !== undefined && isTransport(error)) {
        const goodKey = cacheKey(screenKey, good)
        const goodSealed = await cache.store.data(goodKey)
        if (goodSealed) {
          const screen = await this.materializeSealed(goodSealed, cache).catch(() => undefined)
          if (screen) {
            coordinator.storeRender(screen, goodKey)
            return { screen, origin: 'offline' }
          }
        }
      }
      throw error
    }
    const screen = await this.materialize(raw)                 // fresh bytes verified + validated
    const sealedFresh = await Promise.resolve().then(() => cache.cipher.seal(raw)).catch(() => undefined)
    if (sealedFresh) {                                         // persist + advertise last-good only if sealed
      await cache.store.store(sealedFresh, key)
      coordinator.markGood(screenKey, version)
    }
    coordinator.storeRender(screen, key)
    this.revalidatedAt.set(screenKey, Date.now())             // fresh: no background re-check needed now
    return { screen, origin: 'network' }
  }

  /// Background re-fetch of an unversioned cached screen (stale-while-revalidate).
  /// A newer, verified screen replaces the cache entry and reaches `onUpdate`;
  /// failures leave the cached screen in place. One in flight per key.
  private revalidate(screenKey: string, key: string, current: ScreenSpec, cache: SduiCache, coordinator: CacheCoordinator, options: LoadOptions, minIntervalMs: number): void {
    const last = this.revalidatedAt.get(screenKey) ?? 0
    if (this.revalidating.has(screenKey) || (minIntervalMs > 0 && Date.now() - last < minIntervalMs)) return
    this.revalidatedAt.set(screenKey, Date.now())
    const job = (async () => {
      try {
        const raw = await this.screenFactory.data(screenKey, { signal: options.signal })
        const screen = await this.materialize(raw)
        if (JSON.stringify(canonical(screen.toJSON())) === JSON.stringify(canonical(current.toJSON()))) {
          this.emit({ type: 'screen_revalidated', key: screenKey, changed: false })
          return
        }
        const sealed = await Promise.resolve().then(() => cache.cipher.seal(raw)).catch(() => undefined)
        if (sealed) await cache.store.store(sealed, key)
        coordinator.storeRender(screen, key)
        this.emit({ type: 'screen_revalidated', key: screenKey, changed: true })
        options.onUpdate?.(screen)
      } catch (error) {
        this.emit({ type: 'screen_revalidated', key: screenKey, changed: false, error: error instanceof SduiError ? error.kind : 'decode' })
      } finally {
        this.revalidating.delete(screenKey)
      }
    })()
    this.revalidating.set(screenKey, job)
  }

  /// Resolves when background revalidations have finished.
  async settled(): Promise<void> {
    await Promise.all([...this.revalidating.values()])
  }

  private async materializeSealed(sealed: Uint8Array, cache: SduiCache): Promise<ScreenSpec> {
    return this.materialize(await cache.cipher.open(sealed))
  }

  private async sourceData(source: ScreenSource, options: { signal?: AbortSignal }): Promise<Bytes> {
    switch (source.kind) {
      case 'inline': return source.data
      case 'key': return this.screenFactory.data(source.key, options)
      case 'named':
        if (!this.namedResolver) throw SduiError.unknownScreen(source.name)
        return toBytes(await this.namedResolver(source.name))
    }
  }

  /// Verify/unwrap the raw bytes into the plaintext payload bytes, per policy.
  /// Verification happens on every load — including from cache — so a poisoned
  /// cache is caught too.
  private async unwrap(bytes: Uint8Array): Promise<Uint8Array> {
    const envelope = tryEnvelope(bytes)
    switch (this.security.kind) {
      case 'insecureDevelopment':
        return envelope ? envelope.payload : bytes
      case 'signed':
        if (!envelope) throw SduiError.signatureInvalid()          // required-but-unsigned → reject
        if (!(await this.security.verifier.verify(envelope.payload, envelope.signature, envelope.keyId))) {
          throw SduiError.signatureInvalid()
        }
        return envelope.payload
    }
  }
}

/// The default asset mapping: relative paths only (no scheme, no `//host`,
/// no `..` segments); anything else renders without a `src`.
export function relativeAssetURL(name: string): string {
  if (!name || /^[a-z][a-z0-9+.-]*:/i.test(name) || name.startsWith('//') || name.startsWith('\\') ||
      name.split(/[\\/]/).some((seg) => seg === '..')) return ''
  return name
}

export interface LoadOptions {
  signal?: AbortSignal
  /// stale-while-revalidate: a newer screen found in the background
  onUpdate?: (screen: ScreenSpec) => void
}

const MANIFEST_KEY = 'sdui:manifest'
/// memory hits of unversioned screens re-check the backend at most this often
const REVALIDATE_MEMORY_MS = 30_000

/// `createEngine({...})` — the functional entry point.
let idCounter = 0

/// A v4 UUID. `crypto.randomUUID()` exists only in secure contexts on recent
/// engines (Chromium 92+, Safari 15.4+); `crypto.getRandomValues` is available
/// everywhere a WebView runs, secure context or not. Without either (no Web Crypto
/// at all) a time + counter id keeps keys unique within the app session — an
/// idempotency key only has to be unique, not secret.
export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  if (typeof c?.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6]! & 0x0f) | 0x40   // version 4
    b[8] = (b[8]! & 0x3f) | 0x80   // RFC 4122 variant
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  return `${Date.now().toString(36)}-${(++idCounter).toString(36)}`
}

export function createEngine(init: EngineInit = {}): SduiEngine {
  return new SduiEngine(init)
}

/// Only a transport failure (offline, 5xx) may fall back to the last-good version.
function isTransport(error: unknown): boolean {
  if (!(error instanceof SduiError)) return true
  return error.kind === 'network' || (error.kind === 'http' && (error.status ?? 0) >= 500)
}

function tryEnvelope(bytes: Uint8Array): SduiEnvelope | undefined {
  try {
    return SduiEnvelope.decode(parseJSON(bytes))
  } catch {
    return undefined
  }
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
