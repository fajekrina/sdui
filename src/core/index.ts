/**
 * @fajekrina/sdui — Universal Core (framework-agnostic, no DOM access).
 * Side effects go through ports (see ./ports); browser implementations live
 * in `@fajekrina/sdui/browser`. Inline style only via buildLayoutStyle.
 */

export * from './types'
export { TOKENS, resolveSpacing, hasBackgroundOverride, buildLayoutStyle, styleObjectToCssText, validateDistanceProps, UniversalStyleUtils } from './style'
export * from './tree'
export * from './validate'
export * from './theme'
export * from './sign'
export * from './cache'
export * from './props'
export * from './ports'
export * from './actions'
export * from './ui-store'
export * from './registry'
export * from './view-model'
export * from './loader'
export * from './runtime'

type FetchLike = typeof fetch
const globalFetch = (): FetchLike => (globalThis as unknown as { fetch: FetchLike }).fetch

/**
 * @deprecated since 0.3 — use createRuntime().load() with a NetworkPort
 * (`browserPorts()` from `@fajekrina/sdui/browser`). Removed in 1.0.
 */
export async function fetchUniversalPage(
  merchantId: string,
  pageKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<import('./types').UniversalPageConfig> {
  const base = opts.baseUrl ?? '/api/universal/v1'
  const f = opts.fetchImpl ?? globalFetch()
  const res = await f(`${base}/merchant/pages/${merchantId}/${pageKey}`)
  if (!res.ok) throw new Error(`fetchUniversalPage failed ${res.status}: ${await res.text()}`)
  return (await res.json()) as import('./types').UniversalPageConfig
}

/** @deprecated since 0.3 — use createRuntime().load(). Removed in 1.0. */
export async function fetchUniversalPublishedPage(
  merchantId: string,
  pageKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<import('./types').UniversalPageConfig> {
  const base = opts.baseUrl ?? '/api/universal/v1'
  const f = opts.fetchImpl ?? globalFetch()
  const res = await f(`${base}/client/page/${merchantId}/${pageKey}`)
  if (!res.ok) throw new Error(`fetchUniversalPublishedPage failed ${res.status}: ${await res.text()}`)
  return (await res.json()) as import('./types').UniversalPageConfig
}

/** @deprecated since 0.3 — call the merchant API from your app. Removed in 1.0. */
export async function fetchUniversalPages(
  merchantId: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<string[]> {
  const base = opts.baseUrl ?? '/api/universal/v1'
  const f = opts.fetchImpl ?? globalFetch()
  const res = await f(`${base}/merchant/pages/${merchantId}`)
  if (!res.ok) throw new Error(`fetchUniversalPages failed ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { pages?: string[] }
  return data.pages ?? []
}
