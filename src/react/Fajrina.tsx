/**
 * Fajrina SDUI — React adapter (thin view binding).
 * All decisions (validation, style, actions, form state, toast/modal) live in
 * the core runtime; this file only subscribes to it and renders RenderNodes.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FajrinaData, FajrinaActionEvent } from '../core/types'
import type { SduiPolicy, SduiBounds } from '../core/validate'
import type { UniversalTheme } from '../core/theme'
import type { SduiPorts } from '../core/ports'
import type { LoadResult, VerifyOptions } from '../core/loader'
import { createRuntime, type RuntimeOptions, type SduiRuntime } from '../core/runtime'
import { browserPorts, hasBrowser } from '../browser'
import { SduiNode } from './SduiNode'

export interface FajrinaProps {
  /** page data (0.2 contract). Either `data` or `source`. */
  data?: FajrinaData
  /** let the runtime load the page (network + ETag + verify + last-good cache) */
  source?: { merchantId: string; pageKey: string }
  onAction?: (event: FajrinaActionEvent) => void
  /** called after each `source` load */
  onLoad?: (result: LoadResult) => void
  className?: string
  style?: React.CSSProperties
  /** warn = log only (default); strict = fail closed, render the error page instead */
  mode?: 'warn' | 'strict'
  /** app policy — upper bound; the payload policy may only narrow it */
  policy?: SduiPolicy
  /** project theme for token refs; missing tokens fall back to built-in presets */
  theme?: UniversalTheme
  bounds?: SduiBounds
  /** override any port (navigation → your router, network → your API client, …) */
  ports?: SduiPorts
  verify?: VerifyOptions
  /** share one runtime (and its UI state) between several components */
  runtime?: SduiRuntime
}

/** Create a runtime bound to this component's lifetime. Browser ports are the default on the client. */
export function useSduiRuntime(options: RuntimeOptions = {}): SduiRuntime {
  const ref = useRef<SduiRuntime | null>(null)
  const portsRef = useRef(options.ports)
  if (!ref.current) ref.current = createRuntime(options, hasBrowser() ? browserPorts() : undefined)
  const { ports, ...rest } = options
  ref.current.setOptions(rest)
  if (ports !== portsRef.current) {
    portsRef.current = ports
    ref.current.setOptions({ ports })
  }
  useEffect(() => {
    const rt = ref.current
    return () => rt?.destroy()
  }, [])
  return ref.current
}

export function Fajrina({ data, source, onAction, onLoad, className, style, mode = 'warn', policy, theme, bounds, ports, verify, runtime }: FajrinaProps) {
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction
  const own = useSduiRuntime({ mode, policy, theme, bounds, ports, verify, onAction: (e) => onActionRef.current?.(e) })
  const rt = runtime ?? own
  useSyncExternalStore(rt.subscribe, rt.getState, rt.getState)

  const [loaded, setLoaded] = useState<LoadResult | null>(null)
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad
  const mid = source?.merchantId
  const key = source?.pageKey
  useEffect(() => {
    if (!mid || !key) return
    let alive = true
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    rt.load({ merchantId: mid, pageKey: key, signal: ac?.signal }).then((r) => {
      if (!alive) return
      setLoaded(r)
      onLoadRef.current?.(r)
    })
    return () => { alive = false; ac?.abort() }
  }, [rt, mid, key])

  if (data === undefined && source && !loaded) return <div className={className} style={style} aria-busy="true" />
  const result = rt.render(data !== undefined ? data : loaded?.page)
  return (
    <div className={className} style={style}>
      {result.nodes.map((n) => <SduiNode key={n.key} node={n} runtime={rt} />)}
      {result.overlays.map((n) => <SduiNode key={n.key} node={n} runtime={rt} />)}
    </div>
  )
}

export default Fajrina
