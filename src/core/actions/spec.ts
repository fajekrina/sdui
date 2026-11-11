import { SduiError } from '../errors'
import { SduiValue, type SduiProps } from '../value'

/// The closed action vocabulary. A payload cannot express arbitrary behavior —
/// it can only pick one of these. v1: murti's five; v1.1 adds `toast`, `native`.
export type ActionType = 'navigate' | 'api' | 'dismiss' | 'refresh' | 'openURL' | 'toast' | 'native'

export const ActionType = {
  allCases: ['navigate', 'api', 'dismiss', 'refresh', 'openURL', 'toast', 'native'] as readonly ActionType[],
  is(value: unknown): value is ActionType {
    return typeof value === 'string' && (ActionType.allCases as readonly string[]).includes(value)
  }
}

export type Presentation = 'push' | 'sheet' | 'fullScreen'
export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

const PRESENTATIONS: readonly string[] = ['push', 'sheet', 'fullScreen']
const LEVELS: readonly string[] = ['info', 'success', 'warning', 'error']

export interface ActionSpecInit {
  type: ActionType
  screen?: string
  presentation?: Presentation
  request?: string
  link?: string
  message?: string
  level?: ToastLevel
  command?: string
  params?: SduiProps
  onSuccess?: ActionSpec
  onError?: ActionSpec
}

/// The *data* form of an action; the dispatcher turns it into behavior. Targets
/// are named references — a screen key, a named request, a named link, a named
/// native command — never a raw URL.
///
/// `onSuccess`/`onError` form a bounded LINEAR chain, not an arbitrary tree.
export class ActionSpec {
  readonly type: ActionType
  readonly screen?: string             // navigate → a screen key
  readonly presentation?: Presentation // navigate → push | sheet | fullScreen
  readonly request?: string            // api → an allow-listed named request
  readonly link?: string               // openURL → an allow-listed named link
  readonly message?: string            // toast → text ({{token}}s allowed)
  readonly level?: ToastLevel          // toast → severity
  readonly command?: string            // native → an allow-listed host command
  readonly params?: SduiProps
  readonly onSuccess?: ActionSpec
  readonly onError?: ActionSpec

  constructor(init: ActionSpecInit) {
    this.type = init.type
    for (const key of ['screen', 'presentation', 'request', 'link', 'message', 'level', 'command', 'params', 'onSuccess', 'onError'] as const) {
      if (init[key] !== undefined) (this as Record<string, unknown>)[key] = init[key]
    }
  }

  /// Structural decode. An unknown `type`, `presentation`, or `level` is rejected
  /// (closed vocabularies); unknown keys are ignored.
  static decode(raw: unknown, path = 'action'): ActionSpec {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw SduiError.decode(`${path}: expected an object`)
    const o = raw as Record<string, unknown>
    if (!ActionType.is(o.type)) throw SduiError.decode(`${path}.type: unknown action type ${JSON.stringify(o.type)}`)
    const presentation = optionalString(o.presentation, `${path}.presentation`)
    if (presentation !== undefined && !PRESENTATIONS.includes(presentation)) throw SduiError.decode(`${path}.presentation: unknown value ${JSON.stringify(presentation)}`)
    const level = optionalString(o.level, `${path}.level`)
    if (level !== undefined && !LEVELS.includes(level)) throw SduiError.decode(`${path}.level: unknown value ${JSON.stringify(level)}`)
    return new ActionSpec({
      type: o.type,
      screen: optionalString(o.screen, `${path}.screen`),
      presentation: presentation as Presentation | undefined,
      request: optionalString(o.request, `${path}.request`),
      link: optionalString(o.link, `${path}.link`),
      message: optionalString(o.message, `${path}.message`),
      level: level as ToastLevel | undefined,
      command: optionalString(o.command, `${path}.command`),
      params: o.params == null ? undefined : SduiValue.decodeObject(o.params, `${path}.params`),
      onSuccess: o.onSuccess == null ? undefined : ActionSpec.decode(o.onSuccess, `${path}.onSuccess`),
      onError: o.onError == null ? undefined : ActionSpec.decode(o.onError, `${path}.onError`)
    })
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { type: this.type }
    for (const key of ['screen', 'presentation', 'request', 'link', 'message', 'level', 'command', 'params'] as const) {
      if (this[key] !== undefined) out[key] = this[key]
    }
    if (this.onSuccess !== undefined) out.onSuccess = this.onSuccess.toJSON()
    if (this.onError !== undefined) out.onError = this.onError.toJSON()
    return out
  }

  equals(other: ActionSpec | undefined): boolean {
    return !!other && JSON.stringify(canonical(this.toJSON())) === JSON.stringify(canonical(other.toJSON()))
  }
}

export function optionalString(value: unknown, path: string): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw SduiError.decode(`${path}: expected a string`)
  return value
}

/// Key-sorted copy for equality checks.
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key])
    return out
  }
  return value
}
