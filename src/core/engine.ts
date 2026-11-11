import { ActionDispatcher } from './actions/dispatcher'
import { SduiError } from './errors'
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
  /// maps an image `name` to a URL (default: the name, relative to the document)
  assetURL?: (name: string) => string
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
  private readonly namedResolver?: (name: string) => Promise<BytesLike>
  private readonly manifestLoader?: () => Promise<BytesLike>
  private readonly onEvent?: (event: SduiEvent) => void

  constructor(init: EngineInit = {}) {
    this.componentFactory = init.componentFactory ?? ComponentFactory.withBuiltins()
    this.screenFactory = init.screenFactory ?? new ScreenFactory()
    this.actionDispatcher = init.actionDispatcher ?? new ActionDispatcher()
    this.validator = init.validator ?? new SchemaValidator()
    this.security = init.security ?? PayloadSecurity.insecureDevelopment
    if (init.cache) {
      this.cache = init.cache
      this.coordinator = new CacheCoordinator(init.cache.renderCacheLimit)
    }
    this.namedResolver = init.namedResolver
    this.manifestLoader = init.manifestLoader
    this.assetURL = init.assetURL ?? ((name) => name)
    this.viewport = init.viewport
    this.onEvent = init.onEvent
    this.logger = init.logger ?? consoleLogger
    this.debug = init.debug ?? false
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
  async load(source: ScreenSource, options: { signal?: AbortSignal } = {}): Promise<LoadState> {
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
    if (!this.coordinator || !this.manifestLoader) return
    const raw = toBytes(await this.manifestLoader())
    const manifest = Manifest.fromJSON(await this.unwrap(raw))   // verify signature
    if (!this.coordinator.apply(manifest)) {
      this.emit({ type: 'rollback_rejected', sequence: manifest.sequence })
    }
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

  private async loadCached(screenKey: string, cache: SduiCache, coordinator: CacheCoordinator, options: { signal?: AbortSignal }): Promise<{ screen: ScreenSpec; origin: LoadOrigin }> {
    const version = coordinator.version(screenKey) ?? 'unversioned'
    const key = cacheKey(screenKey, version)

    const rendered = coordinator.renderCached(key)                                     // memory tier
    if (rendered) return { screen: rendered, origin: 'memory' }

    const sealed = await cache.store.data(key)                                         // persistent tier
    if (sealed) {
      const screen = await this.materializeSealed(sealed, cache).catch(() => undefined) // re-verify
      if (screen) {
        coordinator.storeRender(screen, key)
        coordinator.markGood(screenKey, version)
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
    return { screen, origin: 'network' }
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

/// `createEngine({...})` — the functional entry point.
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
