/// Rendering bounds — the DoS defense. They cap worst-case decode / validate /
/// render cost regardless of what an authentic-but-malicious payload asks for.
///
/// Some (string length, prop/child/array counts, identifier length) are also
/// expressed in `spec/sdui.schema.json`; the client enforces ALL of them because it
/// cannot trust that the server ran the schema. Depth, total node count, and
/// action-chain depth, and load-request count are client-only — JSON Schema cannot express recursion
/// limits.
export class SduiBounds {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxStringLength: number
  readonly maxProps: number
  readonly maxChildren: number
  readonly maxArrayItems: number
  readonly maxIdentifierLength: number
  readonly maxChainDepth: number
  /// v1.1 — `screen.load` requests per screen.
  readonly maxLoadRequests: number

  constructor(init: Partial<SduiBounds> = {}) {
    this.maxDepth = init.maxDepth ?? 32
    this.maxNodes = init.maxNodes ?? 5000
    this.maxStringLength = init.maxStringLength ?? 4096
    this.maxProps = init.maxProps ?? 64
    this.maxChildren = init.maxChildren ?? 256
    this.maxArrayItems = init.maxArrayItems ?? 512
    this.maxIdentifierLength = init.maxIdentifierLength ?? 128
    this.maxChainDepth = init.maxChainDepth ?? 4
    this.maxLoadRequests = init.maxLoadRequests ?? 8
  }

  static readonly default = new SduiBounds()
}
