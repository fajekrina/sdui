/**
 * Fajrina SDUI — Universal Style Utils (port of universal-style-utils.js)
 * Spec: universal-components.json + universal-tokens.json
 * Agnostic: inline CSS only, no Tailwind/Bootstrap classes bundled.
 */

export const TOKENS: Record<string, string> = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px'
}

export function resolveSpacing(value: unknown, fallback: string | undefined): string | undefined {
  if (value == null || value === '') return fallback
  const str = String(value).trim()
  if (TOKENS[str] != null) return TOKENS[str]
  return str
}

export function hasBackgroundOverride(style: Record<string, unknown> | undefined): boolean {
  if (!style || typeof style !== 'object') return false
  return !!((style as Record<string, unknown>).background || (style as Record<string, unknown>).backgroundColor || (style as Record<string, unknown>)['background-color'])
}

export type UniversalComponentTypeStyle =
  | 'Button' | 'Card' | 'Container' | 'Flex' | 'Grid' | 'Heading' | 'Image' | 'Text'
  | 'Form' | 'Input' | 'Select' | 'Textarea' | 'Link' | 'Divider' | 'Hero' | 'Space'
  | 'Toast' | 'Modal'

// ponytail: true agnostic — themed preset deferred, add when demand
export function buildLayoutStyle(
  type: string,
  props: Record<string, unknown> = {},
  style: Record<string, unknown> = {}
): Record<string, string> {
  const base: Record<string, string> = { ...(style as Record<string, string>) }

  switch (type) {
    case 'Button': {
      // netral: semua variant sama, warna hanya dari style override (JSON)
      if (!base.display) base.display = 'inline-flex'
      if (!base.alignItems) base.alignItems = 'center'
      if (!base.justifyContent) base.justifyContent = 'center'
      if (!base.borderRadius) base.borderRadius = '8px'
      if (!base.padding) base.padding = '10px 16px'
      if (!base.fontSize) base.fontSize = '14px'
      if (!base.fontWeight) base.fontWeight = '600'
      if (!base.lineHeight) base.lineHeight = '1.4'
      if (!base.border) base.border = '1px solid #e2e8f0'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#ffffff'
      if (!base.color) base.color = '#0f172a'
      if (!base.cursor) base.cursor = 'pointer'
      if (!base.boxSizing) base.boxSizing = 'border-box'
      break
    }
    case 'Card': {
      if (!base.border) base.border = '1px solid #e2e8f0'
      if (!base.borderRadius) base.borderRadius = '12px'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#ffffff'
      if (!base.overflow) base.overflow = 'hidden'
      if (!base.padding) base.padding = '16px'
      break
    }
    case 'Hero': {
      if (!base.border) base.border = '1px solid #e2e8f0'
      if (!base.borderRadius) base.borderRadius = '12px'
      if (!base.padding) base.padding = '20px'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#f8fafc'
      break
    }
    case 'Input':
    case 'Select':
    case 'Textarea': {
      if (!base.width) base.width = '100%'
      if (!base.border) base.border = '1px solid #cbd5e1'
      if (!base.borderRadius) base.borderRadius = '6px'
      if (!base.padding) base.padding = '8px 12px'
      if (!base.fontSize) base.fontSize = '14px'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#ffffff'
      if (!base.boxSizing) base.boxSizing = 'border-box'
      break
    }
    case 'Form': {
      if (!base.border) base.border = '1px solid #e2e8f0'
      if (!base.borderRadius) base.borderRadius = '12px'
      if (!base.padding) base.padding = '16px'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#ffffff'
      break
    }
    case 'Divider': {
      if (!base.height) base.height = '1px'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#e2e8f0'
      if (!base.border) base.border = 'none'
      if (!base.margin) base.margin = '8px 0'
      break
    }
    case 'Heading': {
      if (!base.margin) base.margin = '0'
      if (!base.fontWeight) base.fontWeight = '700'
      break
    }
    case 'Text': {
      if (!base.margin) base.margin = '0'
      break
    }
    case 'Image': {
      if (!base.maxWidth) base.maxWidth = '100%'
      if (!base.display) base.display = 'block'
      break
    }
    case 'Link': {
      if (!base.color) base.color = '#2563eb'
      if (!base.textDecoration) base.textDecoration = 'underline'
      if (!base.cursor) base.cursor = 'pointer'
      break
    }
    case 'Toast': {
      if (!base.position) base.position = 'fixed'
      if (!base.right) base.right = '12px'
      if (!base.bottom) base.bottom = '12px'
      if (!base.backgroundColor && !base.background) base.backgroundColor = '#0f172a'
      if (!base.color) base.color = '#ffffff'
      if (!base.padding) base.padding = '10px 14px'
      if (!base.borderRadius) base.borderRadius = '8px'
      if (!base.fontSize) base.fontSize = '13px'
      if (!base.zIndex) base.zIndex = '9999'
      if (!base.boxShadow) base.boxShadow = '0 4px 12px rgba(0,0,0,.15)'
      if (!base.maxWidth) base.maxWidth = '360px'
      break
    }
    case 'Modal': {
      if (!base.position) base.position = 'fixed'
      if (!base.inset) base.inset = '0'
      if (!base.display) base.display = 'flex'
      if (!base.alignItems) base.alignItems = 'center'
      if (!base.justifyContent) base.justifyContent = 'center'
      if (!base.backgroundColor && !base.background) base.backgroundColor = 'rgba(15,23,42,.6)'
      if (!base.zIndex) base.zIndex = '60'
      break
    }
    case 'Flex': {
      base.display = 'flex'
      base.flexDirection = props.direction === 'column' ? 'column' : 'row'
      base.gap = resolveSpacing(props.gap, '12px') as string
      const j = props.justify as string | undefined
      const justifyMap: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' }
      base.justifyContent = justifyMap[j ?? ''] || 'flex-start'
      if (!base.flexWrap) base.flexWrap = 'wrap'
      break
    }
    case 'Grid': {
      base.display = 'grid'
      const raw = (props.columns ?? props.numColumns) as unknown
      const cols = Math.min(12, Math.max(1, parseInt(String(raw ?? '2'), 10) || 2))
      base.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`
      base.gap = resolveSpacing(props.gap, '16px') as string
      break
    }
    case 'Space': {
      base.height = resolveSpacing(props.height, '16px') as string
      break
    }
    case 'Container': {
      if (props.gap) base.gap = resolveSpacing(props.gap, undefined) as string
      break
    }
    default:
      break
  }
  return base
}

export function styleObjectToCssText(styleObj: Record<string, unknown> | undefined): string {
  if (!styleObj || typeof styleObj !== 'object') return ''
  return Object.entries(styleObj)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';')
}

export function validateDistanceProps(type: string, props: Record<string, unknown> = {}): string[] {
  const errors: string[] = []
  if (type === 'Grid') {
    const raw = (props.columns ?? props.numColumns) as unknown
    if (raw != null) {
      const n = parseInt(String(raw), 10)
      if (isNaN(n) || n < 1 || n > 12) errors.push(`Grid.columns must be integer 1-12, got ${raw}`)
    }
  }
  if (type === 'Flex' && props.direction && !['row', 'column'].includes(String(props.direction))) {
    errors.push(`Flex.direction must be row|column, got ${props.direction}`)
  }
  if (type === 'Flex' && props.justify && !['start', 'center', 'end', 'between'].includes(String(props.justify))) {
    errors.push(`Flex.justify must be start|center|end|between, got ${props.justify}`)
  }
  return errors
}

export const UniversalStyleUtils = {
  TOKENS,
  resolveSpacing,
  buildLayoutStyle,
  styleObjectToCssText,
  validateDistanceProps,
  hasBackgroundOverride
}

export default UniversalStyleUtils
