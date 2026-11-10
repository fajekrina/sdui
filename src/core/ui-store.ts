/**
 * Fajrina SDUI — UI store: toast, modal and form state, framework-free.
 * Immutable snapshots + subscribe, so React (useSyncExternalStore), Vue
 * (shallowRef) and vanilla can all bind to the same state.
 */

export interface ToastState { id: string; message: string }
export interface ModalState { id: string; title?: string; message?: string }
export interface FormState { values: Record<string, string>; errors: Record<string, string> }

export interface UiState {
  toasts: ToastState[]
  modal: ModalState | null
  forms: Record<string, FormState>
}

/** 'field' = a single input changed (vanilla skips re-render: the DOM already has the value) */
export type UiChange = 'field' | 'errors' | 'toast' | 'modal' | 'reset'

export interface UiStore {
  getState(): UiState
  subscribe(listener: (change: UiChange) => void): () => void
  showToast(message: string, durationMs?: number): void
  dismissToast(id: string): void
  openModal(modal: ModalState): void
  closeModal(): void
  setField(formId: string, name: string, value: string): void
  setErrors(formId: string, errors: Record<string, string>): void
  reset(): void
  destroy(): void
}

const EMPTY: UiState = { toasts: [], modal: null, forms: {} }

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
    showToast(message, durationMs = 2500) {
      const id = `t${++seq}`
      set({ ...state, toasts: [...state.toasts, { id, message }] }, 'toast')
      const timer = setTimeout(() => {
        timers.delete(timer)
        set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) }, 'toast')
      }, durationMs)
      timers.add(timer)
    },
    dismissToast(id) {
      set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) }, 'toast')
    },
    openModal(modal) { set({ ...state, modal }, 'modal') },
    closeModal() { if (state.modal) set({ ...state, modal: null }, 'modal') },
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
