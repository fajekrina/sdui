// The SDUI spec version this engine implements (spec/sdui.schema.json).
// Payloads with the same MAJOR render (unknown minor additions degrade
// gracefully); a different MAJOR is rejected.

/// The spec version this engine writes and fully understands.
export const SPEC_VERSION = '1.1'

/// The only accepted MAJOR.
export const SUPPORTED_MAJOR = 1

/// Built-in component types: v1 (murti) and v1.1 additions.
export const V1_COMPONENTS = ['text', 'image', 'vstack', 'hstack', 'zstack', 'button', 'card'] as const
export const V11_COMPONENTS = ['spacer', 'divider', 'grid', 'scroll', 'list', 'form', 'textField', 'textArea', 'picker'] as const
export type BuiltinComponentType = typeof V1_COMPONENTS[number] | typeof V11_COMPONENTS[number]
