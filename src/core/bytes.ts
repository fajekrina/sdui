/// Bytes crossing the SDUI boundary. The JS counterpart of Swift's `Data`:
/// everything is normalized to a `Uint8Array`; strings are taken as UTF-8.
export type Bytes = Uint8Array

/// What the public API accepts wherever Murti takes `Data`.
export type BytesLike = Uint8Array | ArrayBuffer | string

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function toBytes(input: BytesLike): Bytes {
  if (typeof input === 'string') return encoder.encode(input)
  if (input instanceof Uint8Array) return input
  return new Uint8Array(input)
}

export function utf8(text: string): Bytes {
  return encoder.encode(text)
}

/// Decode UTF-8 bytes; invalid UTF-8 throws (the caller maps it to `SduiError.decode`).
export function utf8String(bytes: BytesLike): string {
  return typeof bytes === 'string' ? bytes : decoder.decode(toBytes(bytes))
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/// Strict base64 decode (the JSON decoder's default data strategy in Swift);
/// returns `undefined` for anything that isn't base64.
export function base64Decode(text: string): Bytes | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return undefined
  try {
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return undefined
  }
}

/// Lowercase hex of the bytes.
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/// JSON with object keys sorted at every level — the counterpart of Swift's
/// `.sortedKeys` output formatting, so encoded output is stable.
export function sortedJSONStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return sortKeys((value as { toJSON(): unknown }).toJSON())
  }
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}
