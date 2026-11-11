import { SduiError } from './errors'

/// A decoded JSON value — the closed value space that crosses the SDUI JSON
/// boundary.
///
/// Keeping the value space closed (no `undefined`, functions, class instances)
/// is what makes bounds-checking and sanitization tractable.
export type SduiValue =
  | string
  | number
  | boolean
  | null
  | SduiValue[]
  | { [key: string]: SduiValue }

/// A component's props bag.
export type SduiProps = Record<string, SduiValue>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// MARK: - Typed access

export const SduiValue = {
  stringValue(v: SduiValue | undefined): string | undefined {
    return typeof v === 'string' ? v : undefined
  },
  doubleValue(v: SduiValue | undefined): number | undefined {
    return typeof v === 'number' ? v : undefined
  },
  intValue(v: SduiValue | undefined): number | undefined {
    return typeof v === 'number' ? Math.trunc(v) : undefined
  },
  boolValue(v: SduiValue | undefined): boolean | undefined {
    return typeof v === 'boolean' ? v : undefined
  },
  arrayValue(v: SduiValue | undefined): SduiValue[] | undefined {
    return Array.isArray(v) ? v : undefined
  },
  objectValue(v: SduiValue | undefined): Record<string, SduiValue> | undefined {
    return isPlainObject(v) ? (v as Record<string, SduiValue>) : undefined
  },

  /// How the value renders when interpolated into a `{{token}}`. Scalars only;
  /// arrays/objects/null interpolate to an empty string.
  displayString(v: SduiValue | undefined): string {
    if (typeof v === 'string') return v
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') {
      if (Math.round(v) === v && Math.abs(v) < 1e15) return String(Math.trunc(v))
      return String(v)
    }
    return ''
  },

  /// Structural decode of an already-parsed JSON value. Rejects anything outside
  /// the closed value space (e.g. `undefined`, non-finite numbers, functions).
  decode(raw: unknown, path = 'value'): SduiValue {
    if (raw === null) return null
    switch (typeof raw) {
      case 'string':
      case 'boolean':
        return raw
      case 'number':
        if (!Number.isFinite(raw)) throw SduiError.decode(`${path}: non-finite number`)
        return raw
      case 'object':
        if (Array.isArray(raw)) return raw.map((item, i) => SduiValue.decode(item, `${path}[${i}]`))
        if (isPlainObject(raw)) return SduiValue.decodeObject(raw, path)
    }
    throw SduiError.decode(`${path}: unsupported JSON value for SduiValue`)
  },

  decodeObject(raw: unknown, path = 'value'): Record<string, SduiValue> {
    if (!isPlainObject(raw)) throw SduiError.decode(`${path}: expected an object`)
    const out: Record<string, SduiValue> = {}
    for (const [key, value] of Object.entries(raw)) out[key] = SduiValue.decode(value, `${path}.${key}`)
    return out
  },

  /// Deep structural equality.
  equals(a: SduiValue | undefined, b: SduiValue | undefined): boolean {
    if (a === b) return true
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((item, i) => SduiValue.equals(item, b[i]))
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ka = Object.keys(a)
      const kb = Object.keys(b)
      return ka.length === kb.length && ka.every((k) => k in b && SduiValue.equals(a[k] as SduiValue, b[k] as SduiValue))
    }
    return false
  }
}
