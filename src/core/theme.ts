/**
 * Fajrina SDUI — Design tokens shared by every renderer adapter.
 *
 * Token ownership is layered (highest precedence first):
 *   1. inline `style` on the component (always wins, backward compatible),
 *   2. `token` refs on the component, resolved against a project theme,
 *   3. the project theme's own defaults,
 *   4. the library's built-in presets (TOKENS + buildLayoutStyle defaults).
 *
 * A token ref has the form "Category.name" (e.g. "brand.primary",
 * "space.md") and resolves to theme.tokens[Category][name]. Unknown or
 * malformed refs are ignored (fail-soft) so old payloads keep rendering.
 * Scalar values (string/number/boolean) only — no functions, no expressions.
 */

export interface UniversalTheme {
  /** theme version, locked against the payload's policy themeVersion */
  version?: string
  tokens?: Record<string, Record<string, string>>
}

const TOKEN_REF = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/

export function resolveTokenRef(ref: string, theme: UniversalTheme): string | undefined {
  if (!TOKEN_REF.test(ref)) return undefined
  const dot = ref.indexOf('.')
  const category = ref.slice(0, dot)
  const name = ref.slice(dot + 1)
  const value = theme.tokens?.[category]?.[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Merge a component's token refs into a style object WITHOUT mutating inputs.
 * Precedence per property: existing style value > token value > (preset).
 * Unknown refs are skipped so presets fill the gap downstream.
 */
export function applyThemeToStyle(
  style: Record<string, unknown> | undefined,
  token: Record<string, unknown> | undefined,
  theme: UniversalTheme
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(style ?? {}) }
  if (!token || typeof token !== 'object') return merged
  for (const [cssProp, ref] of Object.entries(token)) {
    if (merged[cssProp] != null) continue
    if (typeof ref !== 'string') continue
    const value = resolveTokenRef(ref, theme)
    if (value != null) merged[cssProp] = value
  }
  return merged
}

/**
 * Recursively resolve token refs across a component list, returning NEW
 * component objects (inputs untouched — safe for React memoization).
 */
export function resolveThemeTokens<T extends { style?: unknown; token?: unknown; children?: T[] }>(
  components: T[] | undefined,
  theme: UniversalTheme | undefined
): T[] {
  if (!components || !theme) return components ?? []
  return components.map((comp) => {
    const out = { ...comp } as T & Record<string, unknown>
    const merged = applyThemeToStyle(
      comp.style as Record<string, unknown> | undefined,
      (comp as unknown as Record<string, unknown>).token as Record<string, unknown> | undefined,
      theme
    )
    if (Object.keys(merged).length > 0 || 'style' in comp) out.style = merged
    if (out.children !== undefined) {
      out.children = resolveThemeTokens(comp.children as T[], theme) as T['children']
    }
    return out as T
  })
}
