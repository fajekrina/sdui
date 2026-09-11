/**
 * fajrina-sdui — Universal Core (agnostic)
 * No Tailwind/Bootstrap bundled. Inline style only via buildLayoutStyle.
 */

export * from './types'
export { TOKENS, resolveSpacing, hasBackgroundOverride, buildLayoutStyle, styleObjectToCssText, validateDistanceProps, UniversalStyleUtils } from './style'
export * from './tree'

/**
 * Helper: fetch Universal page from backend (ergonomic, not required for <Fajrina data>)
 * Mirrors universal-react-renderer.html / universal-vue-renderer.html loadPages logic.
 */
export async function fetchUniversalPage(
  merchantId: string,
  pageKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<import('./types').UniversalPageConfig> {
  const base = opts.baseUrl ?? '/api/universal'
  const f = opts.fetchImpl ?? fetch
  const res = await f(`${base}/merchant/pages/${merchantId}/${pageKey}`)
  if (!res.ok) throw new Error(`fetchUniversalPage failed ${res.status}: ${await res.text()}`)
  return (await res.json()) as import('./types').UniversalPageConfig
}

export async function fetchUniversalPublishedPage(
  merchantId: string,
  pageKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<import('./types').UniversalPageConfig> {
  const base = opts.baseUrl ?? '/api/universal'
  const f = opts.fetchImpl ?? fetch
  const res = await f(`${base}/client/page/${merchantId}/${pageKey}`)
  if (!res.ok) throw new Error(`fetchUniversalPublishedPage failed ${res.status}: ${await res.text()}`)
  return (await res.json()) as import('./types').UniversalPageConfig
}

export async function fetchUniversalPages(
  merchantId: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<string[]> {
  const base = opts.baseUrl ?? '/api/universal'
  const f = opts.fetchImpl ?? fetch
  const res = await f(`${base}/merchant/pages/${merchantId}`)
  if (!res.ok) throw new Error(`fetchUniversalPages failed ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { pages?: string[] }
  return data.pages ?? []
}
