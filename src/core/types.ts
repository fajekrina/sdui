/**
 * Fajrina SDUI — Universal Types (port of UniversalPageConfig.java + universal/components.json)
 * Only Universal scope, no Puck/SDUI legacy.
 */

export type UniversalStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export type UniversalComponentType =
  | 'Button' | 'Card' | 'Container' | 'Flex' | 'Grid' | 'Heading' | 'Image' | 'Text'
  | 'Form' | 'Input' | 'Select' | 'Textarea' | 'Link' | 'Divider' | 'Hero' | 'Space'
  | 'Toast' | 'Modal'

export type UniversalBehavior =
  | 'navigate' | 'back' | 'submit' | 'openModal' | 'closeModal' | 'externalLink' | 'toast' | 'customEvent' | 'api'

export interface UniversalAction {
  behavior?: UniversalBehavior
  target?: string
  href?: string
  modalId?: string
  message?: string
  eventName?: string
  title?: string
  params?: Record<string, unknown>
  /** `api` action: request target (must pass policy.allowedDomains) */
  url?: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** linear chain, depth bounded by SduiBounds.maxChainDepth */
  onSuccess?: UniversalAction
  onError?: UniversalAction
  /** @deprecated legacy alias of `behavior`, removed in 1.0 */
  action?: string
}

export interface UniversalComponent {
  type?: UniversalComponentType
  component?: UniversalComponentType
  id: string
  props?: Record<string, unknown>
  style?: Record<string, string>
  children?: UniversalComponent[]
  parentId?: string | null
  order?: number
  action?: UniversalAction
  [key: string]: unknown
}

export interface UniversalLayout {
  type?: string
  title?: string
  subtitle?: string
  components?: UniversalComponent[]
  [key: string]: unknown
}

export interface UniversalPageConfig {
  pageId?: string
  pageKey?: string
  merchantId?: string
  status?: UniversalStatus | string
  version?: number
  createdAt?: string
  updatedAt?: string
  layout?: UniversalLayout
  [key: string]: unknown
}

/**
 * Data prop accepts multiple shapes for ergonomic <Fajrina data={data}>:
 * - full PageConfig { layout: { components } }
 * - layout { components }
 * - components[] array
 * - single component
 */
export type FajrinaData = UniversalPageConfig | UniversalLayout | UniversalComponent[] | UniversalComponent | null | undefined

export interface FajrinaActionEvent {
  behavior?: string
  /** same as behavior (kept for 0.x consumers) */
  action?: string
  target?: string
  href?: string
  eventName?: string
  /** form values on submit, response body for `api`, missing fields for validationError */
  data?: Record<string, unknown>
  params?: Record<string, unknown>
  sourceComponent: UniversalComponent
  /** skip the library's default effect (navigation/back/externalLink/toast/modal/event) */
  preventDefault?: () => void
  defaultPrevented?: boolean
}

export function normalizeToLayout(data: FajrinaData): UniversalLayout | null {
  if (!data) return null
  if (Array.isArray(data)) {
    return { type: 'Container', components: data as UniversalComponent[] }
  }
  const obj = data as Record<string, unknown>
  if (obj.layout && typeof obj.layout === 'object') {
    return obj.layout as UniversalLayout
  }
  if (obj.components && Array.isArray(obj.components)) {
    return obj as unknown as UniversalLayout
  }
  if ((obj as UniversalComponent).type || (obj as UniversalComponent).component) {
    return { type: 'Container', components: [obj as UniversalComponent] }
  }
  return null
}

export function getComponentType(comp: UniversalComponent): string {
  return (comp.type || comp.component || '') as string
}
