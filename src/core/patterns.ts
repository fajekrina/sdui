/// Named field validators — the only patterns a payload can ask for. A payload
/// names a pattern (`"pattern": "phoneId"`); it never ships a regex, so a payload
/// cannot trigger catastrophic backtracking (ReDoS) in the client.
export const FIELD_PATTERNS: Readonly<Record<string, { test: (value: string) => boolean; message: string }>> = {
  numeric: { test: (v) => /^[0-9]+$/.test(v), message: 'must contain digits only' },
  alphanumeric: { test: (v) => /^[A-Za-z0-9]+$/.test(v), message: 'must contain letters and digits only' },
  email: { test: (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), message: 'must be a valid email' },
  phoneId: { test: (v) => /^(\+62|62|0)8[1-9][0-9]{6,10}$/.test(v), message: 'must be a valid Indonesian mobile number' },
  amount: { test: (v) => /^[0-9]{1,15}(\.[0-9]{1,2})?$/.test(v) && Number(v) > 0, message: 'must be a positive amount' },
  pin6: { test: (v) => /^[0-9]{6}$/.test(v), message: 'must be 6 digits' },
  nik: { test: (v) => /^[0-9]{16}$/.test(v), message: 'must be 16 digits' }
}

export interface FieldRule {
  name: string
  label?: string
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: string
}

/// The first error for a value, or `undefined` when it passes. An unknown
/// pattern name fails the field closed.
export function validateField(rule: FieldRule, raw: string): string | undefined {
  const value = raw.trim()
  const label = rule.label ?? rule.name
  if (!value) return rule.required ? `${label} is required` : undefined
  if (rule.minLength !== undefined && value.length < rule.minLength) return `${label} must be at least ${rule.minLength} characters`
  if (rule.maxLength !== undefined && value.length > rule.maxLength) return `${label} must be at most ${rule.maxLength} characters`
  if (rule.pattern !== undefined) {
    const pattern = FIELD_PATTERNS[rule.pattern]
    if (!pattern) return `${label} uses an unknown pattern`
    if (!pattern.test(value)) return `${label} ${pattern.message}`
  }
  return undefined
}
