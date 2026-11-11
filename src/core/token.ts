import { SduiValue } from './value'

/// Resolves `{{token}}` interpolation in a template string.
///
/// Pure: it takes a `lookup` function rather than the data store directly, so it
/// is trivially testable. Missing tokens resolve to an empty string (fail-soft,
/// never a crash).
export const TokenResolver = {
  resolve(template: string, lookup: (key: string) => SduiValue | undefined): string {
    if (!template.includes('{{')) return template

    let result = ''
    let rest = template

    for (;;) {
      const open = rest.indexOf('{{')
      if (open < 0) break
      result += rest.slice(0, open)
      const afterOpen = rest.slice(open + 2)
      const close = afterOpen.indexOf('}}')
      if (close < 0) {
        // Unterminated token: emit the remainder literally.
        return result + rest.slice(open)
      }
      const key = afterOpen.slice(0, close).replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, '')
      result += SduiValue.displayString(lookup(key))
      rest = afterOpen.slice(close + 2)
    }

    return result + rest
  }
}

const SINGLE_TOKEN = /^\{\{\s*([^{}]+?)\s*\}\}$/

/// The token keys a template references, in order.
export function tokenKeys(template: string): string[] {
  const keys: string[] = []
  const re = /\{\{([^{}]*)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template))) keys.push(m[1]!.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, ''))
  return keys
}

/// Resolve `{{token}}`s inside a value (params): strings are interpolated, arrays
/// and objects are walked. A string that is exactly one token keeps the resolved
/// value's own type (`"{{form.amount}}"` → `150000`, not `"150000"`).
export function resolveValue(value: SduiValue, lookup: (key: string) => SduiValue | undefined): SduiValue {
  if (typeof value === 'string') {
    const single = SINGLE_TOKEN.exec(value)
    if (single) return lookup(single[1]!) ?? null
    return TokenResolver.resolve(value, lookup)
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, lookup))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, SduiValue> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, lookup)
    return out
  }
  return value
}
