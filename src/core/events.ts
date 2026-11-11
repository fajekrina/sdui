import type { ActionType } from './actions/spec'
import type { LoadOrigin } from './engine'

/// Observability events (`onEvent`). In a WebView the bridge forwards them to
/// native analytics. They never carry tokens, PII, or field values.
export type SduiEvent =
  | { type: 'screen_loaded'; key: string; origin: LoadOrigin; ms: number }
  | { type: 'validation_failed'; source: string; error: string; message: string }
  | { type: 'unknown_component'; componentType: string }
  | { type: 'action_dispatched'; action: ActionType; ok: boolean; target?: string }
  | { type: 'load_request'; request: string; ok: boolean; ms: number }
  | { type: 'form_invalid'; formId: string; fields: string[] }
  | { type: 'rollback_rejected'; sequence: number }
  | { type: 'screen_revalidated'; key: string; changed: boolean; error?: string }
  | { type: 'bridge_error'; method: string; message: string }
