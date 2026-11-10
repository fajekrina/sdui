/**
 * Fajrina SDUI — Component registry: one descriptor per type.
 * Source of truth for the builder palette, validation (allowed behaviors) and
 * the view-model. The backend table `sdui_component_type` is seeded from the
 * same list (a contract test keeps them aligned).
 */

import type { UniversalComponentType } from './types'

export type ComponentCategory = 'layout' | 'content' | 'form' | 'navigation' | 'feedback'

export interface ComponentDescriptor {
  type: UniversalComponentType
  category: ComponentCategory
  acceptsChildren: boolean
  /** behaviors this type may trigger (empty = not interactive) */
  allowedBehaviors: readonly string[]
  /** initial props when dropped on the builder canvas */
  defaultProps: Readonly<Record<string, unknown>>
}

export const BEHAVIORS = [
  'navigate', 'back', 'submit', 'externalLink', 'openModal', 'closeModal', 'toast', 'customEvent', 'api'
] as const
export type KnownBehavior = typeof BEHAVIORS[number]

const ALL = BEHAVIORS
const NONE: readonly string[] = []

export const COMPONENT_REGISTRY: Readonly<Record<UniversalComponentType, ComponentDescriptor>> = {
  Container: { type: 'Container', category: 'layout', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: { as: 'div' } },
  Flex: { type: 'Flex', category: 'layout', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: { direction: 'row', gap: 'md', justify: 'start' } },
  Grid: { type: 'Grid', category: 'layout', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: { columns: 2, gap: 'lg' } },
  Card: { type: 'Card', category: 'layout', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: {} },
  Hero: { type: 'Hero', category: 'layout', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: {} },
  Space: { type: 'Space', category: 'layout', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { height: 'lg' } },
  Divider: { type: 'Divider', category: 'layout', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: {} },
  Heading: { type: 'Heading', category: 'content', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { content: 'Heading', level: 2 } },
  Text: { type: 'Text', category: 'content', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { content: 'Text', tag: 'p' } },
  Image: { type: 'Image', category: 'content', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { src: '', alt: '', loading: 'lazy' } },
  Form: { type: 'Form', category: 'form', acceptsChildren: true, allowedBehaviors: ['submit', 'api', 'navigate', 'toast'], defaultProps: {} },
  Input: { type: 'Input', category: 'form', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { name: 'field', label: 'Field', type: 'text' } },
  Select: { type: 'Select', category: 'form', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { name: 'choice', label: 'Choice', options: [] } },
  Textarea: { type: 'Textarea', category: 'form', acceptsChildren: false, allowedBehaviors: NONE, defaultProps: { name: 'notes', label: 'Notes', rows: 4 } },
  Button: { type: 'Button', category: 'navigation', acceptsChildren: false, allowedBehaviors: ALL, defaultProps: { label: 'Button', type: 'button' } },
  Link: { type: 'Link', category: 'navigation', acceptsChildren: false, allowedBehaviors: ALL, defaultProps: { label: 'Link', href: '#' } },
  Toast: { type: 'Toast', category: 'feedback', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: { message: 'Toast' } },
  Modal: { type: 'Modal', category: 'feedback', acceptsChildren: true, allowedBehaviors: NONE, defaultProps: { title: 'Modal' } }
}

export const COMPONENT_TYPES = Object.keys(COMPONENT_REGISTRY) as UniversalComponentType[]

export function getDescriptor(type: string): ComponentDescriptor | undefined {
  return (COMPONENT_REGISTRY as Record<string, ComponentDescriptor>)[type]
}

/** Builder palette: registry order grouped by category. */
export function paletteTypes(enabled?: readonly string[]): UniversalComponentType[] {
  const order: ComponentCategory[] = ['layout', 'content', 'form', 'navigation', 'feedback']
  return order.flatMap((cat) => COMPONENT_TYPES.filter((t) => COMPONENT_REGISTRY[t].category === cat))
    .filter((t) => !enabled || enabled.includes(t))
}
