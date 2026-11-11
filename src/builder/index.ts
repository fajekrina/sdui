// @fajekrina/sdui/builder — headless editor, DSL, DSL export, preview and the
// Studio UI (DOM). React/Vue wrappers: ./builder/react, ./builder/vue.
export { EditorDocument, type ValidationIssue } from './document'
export * from './tree'
export * from './dsl'
export { DSLExport } from './dsl-export'
export { renderPreview, findNodeJsonRange } from './preview'
export { mountStudio, type StudioOptions, type MountedStudio } from './studio'
export { fromUniversal, toIdentifier, type ConversionResult } from '../compat'
