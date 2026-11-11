/// The single namespaced error type. Library/transport errors are never leaked
/// through the public API — they are mapped onto one of these.
export type SduiErrorKind =
  | 'decode'             // structural decode failure (message)
  | 'schema'             // schema-conformance violation (pattern, required field)
  | 'unsupportedVersion' // schemaVersion major not supported
  | 'unknownType'        // no component registered for this type
  | 'unknownRequest'     // named request not allow-listed
  | 'unknownCommand'     // native command not supported by the host
  | 'unknownScreen'      // screen key not in the factory
  | 'bounds'             // a rendering bound was exceeded
  | 'network'            // transport failure: offline, CORS, abort (no library type leaked)
  | 'http'               // the server answered non-2xx (status, serverCode)
  | 'signatureInvalid'   // authenticity check failed
  | 'rollback'           // a manifest/payload older than the last applied one
  | 'decryptionFailed'
  | 'tokenUnresolved'    // a required token had no value

export class SduiError extends Error {
  readonly kind: SduiErrorKind
  /// The associated value: a message, version, type, request, screen, or token.
  readonly detail?: string
  /// `network` / `http`: the HTTP status, or `null` when there was none.
  readonly status?: number | null
  /// `http`: the backend error code, e.g. universal-service `errorCode: "SDUI-002"`.
  readonly serverCode?: string

  private constructor(kind: SduiErrorKind, detail?: string, status?: number | null, serverCode?: string) {
    super(SduiError.describe(kind, detail, status, serverCode))
    this.name = 'SduiError'
    this.kind = kind
    if (detail !== undefined) this.detail = detail
    if (kind === 'network' || kind === 'http') this.status = status ?? null
    if (serverCode !== undefined) this.serverCode = serverCode
  }

  static decode(message: string) { return new SduiError('decode', message) }
  static schema(message: string) { return new SduiError('schema', message) }
  static unsupportedVersion(version: string) { return new SduiError('unsupportedVersion', version) }
  static unknownType(type: string) { return new SduiError('unknownType', type) }
  static unknownRequest(request: string) { return new SduiError('unknownRequest', request) }
  static unknownCommand(command: string) { return new SduiError('unknownCommand', command) }
  static unknownScreen(key: string) { return new SduiError('unknownScreen', key) }
  static bounds(message: string) { return new SduiError('bounds', message) }
  static network(status: number | null = null) { return new SduiError('network', undefined, status) }
  /// The server answered with a non-2xx status; `message` is its error text.
  static http(status: number, message?: string, serverCode?: string) { return new SduiError('http', message, status, serverCode) }
  static signatureInvalid() { return new SduiError('signatureInvalid') }
  static rollback(message: string) { return new SduiError('rollback', message) }
  static decryptionFailed() { return new SduiError('decryptionFailed') }
  static tokenUnresolved(token: string) { return new SduiError('tokenUnresolved', token) }

  equals(other: unknown): boolean {
    return other instanceof SduiError && other.kind === this.kind && other.detail === this.detail &&
      other.status === this.status && other.serverCode === this.serverCode
  }

  private static describe(kind: SduiErrorKind, detail?: string, status?: number | null, serverCode?: string): string {
    if (kind === 'network') return `network(status: ${status ?? 'nil'})`
    if (kind === 'http') return `http(${status}${serverCode ? ` ${serverCode}` : ''})${detail ? `: ${detail}` : ''}`
    return detail === undefined ? kind : `${kind}(${JSON.stringify(detail)})`
  }
}

/// What a fail-closed error view tells the user (drives its title).
export type ErrorViewKind = 'notFound' | 'forbidden' | 'rejected' | 'unavailable' | 'offline' | 'invalid' | 'blocked'

export const ERROR_TITLES: Record<ErrorViewKind, string> = {
  notFound: 'Not Found',
  forbidden: 'Access Denied',
  rejected: 'Request Rejected',
  unavailable: 'Service Unavailable',
  offline: 'Offline',
  invalid: 'Invalid Page',
  blocked: "Couldn't load this screen"
}

/// Map an error to the kind of error view to show.
export function errorKindOf(error: SduiError): ErrorViewKind {
  switch (error.kind) {
    case 'network': return 'offline'
    case 'unknownScreen': return 'notFound'
    case 'decode':
    case 'signatureInvalid':
    case 'decryptionFailed':
    case 'rollback': return 'invalid'
    case 'http': {
      const status = error.status ?? 0
      if (status === 404 || status === 410) return 'notFound'
      if (status === 401 || status === 403) return 'forbidden'
      if (status >= 500) return 'unavailable'
      return 'rejected'
    }
    default: return 'blocked'
  }
}
