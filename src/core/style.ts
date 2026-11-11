import type { SduiNode } from './node'

// The bounded style layer: a small, closed set of visual props the built-in
// components read. A color is a hex string or a semantic theme token, a weight is
// a known name, a size/radius is a number — validated at render time and simply
// ignored when unrecognized (render-what-you-can). Never author-supplied CSS.

export interface SduiRGBA {
  red: number
  green: number
  blue: number
  alpha: number
}

/// Parse `#RGB`, `#RRGGBB`, or `#RRGGBBAA` (the leading `#` is optional).
export function parseHexColor(hex: string): SduiRGBA | undefined {
  let s = hex.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (s.length === 0 || !/^[0-9A-Fa-f]+$/.test(s)) return undefined
  const channel = (value: number, shift: number) => ((value >>> shift) & 0xff) / 255
  switch (s.length) {
    case 3: {
      const n = parseInt([...s].map((c) => c + c).join(''), 16)
      return { red: channel(n, 16), green: channel(n, 8), blue: channel(n, 0), alpha: 1 }
    }
    case 6: {
      const n = parseInt(s, 16)
      return { red: channel(n, 16), green: channel(n, 8), blue: channel(n, 0), alpha: 1 }
    }
    case 8: {
      const n = parseInt(s, 16)
      return { red: channel(n, 24), green: channel(n, 16), blue: channel(n, 8), alpha: channel(n, 0) }
    }
    default:
      return undefined
  }
}

/// v1.1 — semantic color tokens; each resolves to `var(--sdui-color-<name>, <fallback>)`
/// so a host theme (dark mode, brand) restyles every screen.
export const COLOR_TOKENS: Readonly<Record<string, string>> = {
  primary: '#0A66C2',
  onPrimary: '#FFFFFF',
  secondary: '#5B6B7F',
  surface: '#F2F4F7',
  onSurface: '#111827',
  background: '#FFFFFF',
  muted: '#6B7280',
  border: '#D1D5DB',
  success: '#15803D',
  warning: '#B45309',
  danger: '#B91C1C'
}

/// A CSS color for a hex string or a semantic token, or `undefined`.
export function color(value: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(COLOR_TOKENS, value)) return `var(--sdui-color-${value}, ${COLOR_TOKENS[value]})`
  const c = parseHexColor(value)
  if (!c) return undefined
  const to255 = (v: number) => Math.round(v * 255)
  return `rgba(${to255(c.red)}, ${to255(c.green)}, ${to255(c.blue)}, ${+c.alpha.toFixed(4)})`
}

/// A known font weight name, as a CSS `font-weight`, or `undefined`.
export function fontWeight(name: string): number | undefined {
  switch (name) {
    case 'ultralight': return 100
    case 'thin': return 200
    case 'light': return 300
    case 'regular': return 400
    case 'medium': return 500
    case 'semibold': return 600
    case 'bold': return 700
    case 'heavy': return 800
    case 'black': return 900
    default: return undefined
  }
}

/// The text styles, at the platform's default type sizes.
export function textStyle(style: string): { size: number; weight: number } {
  switch (style) {
    case 'title': return { size: 28, weight: 700 }
    case 'headline': return { size: 17, weight: 600 }
    case 'caption': return { size: 12, weight: 400 }
    default: return { size: 16, weight: 400 }
  }
}

const num = (node: SduiNode, key: string): number | undefined => {
  const v = node.value(key)
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/// The shared container style props (`padding`, `background`, `cornerRadius`,
/// `foreground`), applied only when present.
export function sharedStyle(node: SduiNode, defaults: { padding?: number; background?: string; cornerRadius?: number } = {}): Record<string, string> {
  const style: Record<string, string> = {}
  const padding = num(node, 'padding') ?? defaults.padding
  if (padding !== undefined) style.padding = `${padding}px`
  const background = color(node.string('background')) ?? (defaults.background !== undefined ? color(defaults.background) : undefined)
  if (background) style.background = background
  const radius = num(node, 'cornerRadius') ?? defaults.cornerRadius
  if (radius !== undefined) {
    style.borderRadius = `${radius}px`
    style.overflow = 'hidden'
  }
  const foreground = color(node.string('foreground'))
  if (foreground) style.color = foreground
  return style
}

export { num as numberProp }
