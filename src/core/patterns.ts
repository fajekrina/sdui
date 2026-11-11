/// Named field validators — the only patterns a payload can ask for. A payload
/// names a pattern (`"pattern": "phoneId"`); it never ships a regex, so a payload
/// cannot trigger catastrophic backtracking (ReDoS) in the client.
export const FIELD_PATTERNS: Readonly<Record<string, (value: string) => boolean>> = {
  numeric: (v) => /^[0-9]+$/.test(v),
  alphanumeric: (v) => /^[A-Za-z0-9]+$/.test(v),
  email: (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phoneId: (v) => /^(\+62|62|0)8[1-9][0-9]{6,10}$/.test(v),
  amount: (v) => /^[0-9]{1,15}(\.[0-9]{1,2})?$/.test(v) && Number(v) > 0,
  pin6: (v) => /^[0-9]{6}$/.test(v),
  nik: (v) => /^[0-9]{16}$/.test(v)
}

/// Validation messages — host-localizable (`createEngine({ messages })`).
export interface FieldMessages {
  required(label: string): string
  minLength(label: string, min: number): string
  maxLength(label: string, max: number): string
  /// the value doesn't match the named pattern
  pattern(label: string, pattern: string): string
  /// the payload names a pattern the client doesn't know (fails closed)
  unknownPattern(label: string): string
}

const PATTERN_EN: Record<string, string> = {
  numeric: 'must contain digits only', alphanumeric: 'must contain letters and digits only', email: 'must be a valid email',
  phoneId: 'must be a valid Indonesian mobile number', amount: 'must be a positive amount', pin6: 'must be 6 digits', nik: 'must be 16 digits'
}

export const MESSAGES_EN: FieldMessages = {
  required: (l) => `${l} is required`,
  minLength: (l, n) => `${l} must be at least ${n} characters`,
  maxLength: (l, n) => `${l} must be at most ${n} characters`,
  pattern: (l, p) => `${l} ${PATTERN_EN[p] ?? 'is not valid'}`,
  unknownPattern: (l) => `${l} cannot be validated`
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
export function validateField(rule: FieldRule, raw: string, messages: FieldMessages = MESSAGES_EN): string | undefined {
  const value = raw.trim()
  const label = rule.label ?? rule.name
  if (!value) return rule.required ? messages.required(label) : undefined
  if (rule.minLength !== undefined && value.length < rule.minLength) return messages.minLength(label, rule.minLength)
  if (rule.maxLength !== undefined && value.length > rule.maxLength) return messages.maxLength(label, rule.maxLength)
  if (rule.pattern !== undefined) {
    const test = FIELD_PATTERNS[rule.pattern]
    if (!test) return messages.unknownPattern(label)
    if (!test(value)) return messages.pattern(label, rule.pattern)
  }
  return undefined
}
