// @fajekrina/sdui — the headless engine (entry "."). No DOM, no framework:
// every side effect goes through ports (see "../ports"). Structure and names
// follow MurtiCore one-to-one where they overlap (see NOTICE).

export { SPEC_VERSION, SUPPORTED_MAJOR, V1_COMPONENTS, V11_COMPONENTS, type BuiltinComponentType } from '../spec'

// Model
export { SduiValue, type SduiProps } from './value'
export { SduiError, errorKindOf, ERROR_TITLES, type SduiErrorKind, type ErrorViewKind } from './errors'
export {
  toBytes, utf8, utf8String, bytesEqual, concatBytes, base64Encode, base64Decode, hex, sortedJSONStringify,
  type Bytes, type BytesLike
} from './bytes'
export { SduiNode, type SduiNodeInit } from './node'
export { ActionSpec, ActionType, canonical, type ActionSpecInit, type Presentation, type ToastLevel } from './actions/spec'
export { SduiPayload, ScreenSpec, SduiEnvelope, parseJSON, type LoadRequest, type ScreenVariants } from './payload'
export { SduiBounds } from './bounds'
export { SchemaValidator } from './validator'
export { TokenResolver, tokenKeys, resolveValue } from './token'
export { DataContext } from './data-context'
export { FIELD_PATTERNS, MESSAGES_EN, validateField, type FieldRule, type FieldMessages } from './patterns'

// Rendering
export { renderNode, cleanAttrs, type RenderNode, type RenderElement, type RenderResult } from './render-node'
export { RenderContext, type RenderEnvironment, type RenderSink } from './render-context'
export { ComponentFactory, type Component, type ComponentType, type ComponentInfo, type ViewBuilder } from './component-factory'
export * from './components/builtins'
export { Symbols } from './components/symbols'
export { parseHexColor, color, fontWeight, textStyle, sharedStyle, COLOR_TOKENS, type SduiRGBA } from './style'
export { createUiStore, type UiStore, type UiState, type UiChange, type ToastState, type FormState } from './ui-store'

// Actions
export { ActionDispatcher, type ActionDispatcherInit, type ActionContext, type Command } from './actions/dispatcher'

// Loading, security, cache
export { ScreenFactory, type ScreenProvider } from './screen-factory'
export { PayloadSecurity } from './security'
export { SduiCache, cacheKey, CacheCoordinator, Manifest, MemoryCacheStore, PassthroughCipher, type CacheStore, type CacheCipher } from './cache'

// Engine
export { SduiEngine, createEngine, relativeAssetURL, ScreenSource, LoadState, type EngineInit, type LoadOrigin, type LoadOptions } from './engine'
export { ScreenController, errorView, type RenderOptions } from './screen'
export type { SduiEvent } from './events'

// Ports (contracts + safe defaults)
export * from '../ports'
