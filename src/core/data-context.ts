import { TokenResolver } from './token'
import type { SduiValue } from './value'

/// The token store threaded through a screen render — the glue of the data-context
/// lifecycle.
///
/// Nav params seed it; API responses merge in; `{{token}}` resolves against it at
/// render time. Observable (`subscribe`) so the screen re-renders and re-resolves
/// tokens automatically when values change — no manual invalidation.
export class DataContext {
  private storage: Map<string, SduiValue>
  private readonly listeners = new Set<() => void>()

  constructor(seed: Record<string, SduiValue> = {}) {
    this.storage = new Map(Object.entries(seed))
  }

  /// The top-level value for a key.
  get(key: string): SduiValue | undefined {
    return this.storage.get(key)
  }

  /// A flat snapshot of the current values (used to seed a scoped child).
  get snapshot(): Record<string, SduiValue> {
    return Object.fromEntries(this.storage)
  }

  /// Merge values in (e.g. an API response landing under its request key).
  merge(values: Record<string, SduiValue>): void {
    for (const [key, value] of Object.entries(values)) this.storage.set(key, value)
    for (const listener of [...this.listeners]) listener()
  }

  /// Observe changes; returns the unsubscribe function.
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /// Look up a dotted key path, e.g. `user.name`, walking nested objects.
  value(keyPath: string): SduiValue | undefined {
    const parts = keyPath.split('.').filter((p) => p.length > 0)
    if (parts.length === 0) return undefined
    let current = this.storage.get(parts[0]!)
    for (const part of parts.slice(1)) {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
      current = (current as Record<string, SduiValue>)[part]
    }
    return current
  }

  /// Interpolate `{{token}}`s against this context.
  resolve(template: string): string {
    return TokenResolver.resolve(template, (key) => this.value(key))
  }
}
