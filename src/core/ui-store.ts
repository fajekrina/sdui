/// UI store: toasts and form state, framework-free. Immutable snapshots +
/// subscribe, so React (useSyncExternalStore), Vue (shallowRef) and vanilla all
/// bind to the same state.

import type { ToastLevel } from './actions/spec'

export interface ToastState { id: string; message: string; level: ToastLevel }
export interface FormState { values: Record<string, string>; errors: Record<string, string> }

export interface UiState {
  toasts: ToastState[]
  forms: Record<string, FormState>
}

/// 'field' = a single input changed (vanilla skips re-render: the DOM already has the value)
export type UiChange = 'field' | 'errors' | 'toast' | 'reset'

export interface UiStore {
  getState(): UiState
  subscribe(listener: (change: UiChange) => void): () => void
  showToast(message: string, level?: ToastLevel, durationMs?: number): void
  dismissToast(id: string): void
  setField(formId: string, name: string, value: string): void
  setErrors(formId: string, errors: Record<string, string>): void
  reset(): void
  destroy(): void
}

const EMPTY: UiState = { toasts: [], forms: {} }

export function createUiStore(): UiStore {
  let state: UiState = EMPTY
  let seq = 0
  const listeners = new Set<(change: UiChange) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const set = (next: UiState, change: UiChange) => {
    state = next
    listeners.forEach((l) => l(change))
  }
  const form = (id: string): FormState => state.forms[id] ?? { values: {}, errors: {} }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    showToast(message, level = 'info', durationMs = 2500) {
      const id = `t${++seq}`
      set({ ...state, toasts: [...state.toasts, { id, message, level }] }, 'toast')
      const timer = setTimeout(() => {
        timers.delete(timer)
        set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) }, 'toast')
      }, durationMs)
      timers.add(timer)
    },
    dismissToast(id) {
      set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) }, 'toast')
    },
    setField(formId, name, value) {
      const f = form(formId)
      if (f.values[name] === value) return
      const errors = { ...f.errors }
      const hadError = name in errors
      delete errors[name]
      set({ ...state, forms: { ...state.forms, [formId]: { values: { ...f.values, [name]: value }, errors } } }, hadError ? 'errors' : 'field')
    },
    setErrors(formId, errors) {
      const f = form(formId)
      set({ ...state, forms: { ...state.forms, [formId]: { values: f.values, errors } } }, 'errors')
    },
    reset() { set(EMPTY, 'reset') },
    destroy() {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
      listeners.clear()
    }
  }
}
