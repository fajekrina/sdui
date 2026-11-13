/// Rendering bounds — the DoS defense. They cap worst-case decode / validate /
/// render cost regardless of what an authentic-but-malicious payload asks for.
///
/// The defaults come from `spec/bounds.json`, the single source of these numbers:
/// the bundler inlines them at build time, and a backend reads the same published
/// file (`@fajekrina/sdui/spec/bounds.json`). `tests/spec.test.ts` fails if the
/// schema disagrees with it.
///
/// Some (string length, prop/child/array counts, identifier length, load-request
/// count) are also expressed in `spec/sdui.schema.json`; the client enforces ALL of
/// them because it cannot trust that the server ran the schema. Depth, total node
/// count and action-chain depth are client-only — JSON Schema cannot express
/// recursion limits.
import {
  maxArrayItems, maxChainDepth, maxChildren, maxDepth, maxIdentifierLength,
  maxLoadRequests, maxNodes, maxProps, maxStringLength
} from '../../spec/bounds.json'

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
    this.maxDepth = init.maxDepth ?? maxDepth
    this.maxNodes = init.maxNodes ?? maxNodes
    this.maxStringLength = init.maxStringLength ?? maxStringLength
    this.maxProps = init.maxProps ?? maxProps
    this.maxChildren = init.maxChildren ?? maxChildren
    this.maxArrayItems = init.maxArrayItems ?? maxArrayItems
    this.maxIdentifierLength = init.maxIdentifierLength ?? maxIdentifierLength
    this.maxChainDepth = init.maxChainDepth ?? maxChainDepth
    this.maxLoadRequests = init.maxLoadRequests ?? maxLoadRequests
  }

  static readonly default = new SduiBounds()
}
