/// React adapter: <SduiScreen source={{ key: 'home' }} engine={engine} />.
/// All decisions live in the core ScreenController; this only subscribes and
/// renders RenderNodes.
import React, { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ScreenSource, type LoadState, type SduiEngine } from '../core/engine'
import type { ScreenController } from '../core/screen'
import type { SduiValue } from '../core/value'
import type { BytesLike } from '../core/bytes'
import { RenderNodeView, type ReactSlots } from './RenderNodeView'

/// `{ key }` (ScreenFactory), `{ named }` (host-resolved), `{ payload }` (inline JSON), or a ScreenSource.
export type ScreenSourceInput = ScreenSource | { key: string } | { named: string } | { payload: BytesLike | object }

export function toScreenSource(input: ScreenSourceInput): ScreenSource {
  if ('kind' in input) return input as ScreenSource
  if ('key' in input) return ScreenSource.key(input.key)
  if ('named' in input) return ScreenSource.named(input.named)
  return ScreenSource.inline(input.payload)
}

export interface SduiScreenProps {
  engine: SduiEngine
  source: ScreenSourceInput
  /// initial data (e.g. navigation params)
  seed?: Record<string, SduiValue>
  /// false = static preview (builder)
  interactive?: boolean
  /// toolkit-specific components rendered by React
  slots?: ReactSlots
  onState?: (state: LoadState) => void
  className?: string
  style?: React.CSSProperties
}

/// A screen controller bound to this component's source identity.
export function useSduiScreen(engine: SduiEngine, input: ScreenSourceInput, seed?: Record<string, SduiValue>): ScreenController {
  const source = toScreenSource(input)
  const identity = ScreenSource.identity(source)
  const seedKey = JSON.stringify(seed ?? {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const screen = useMemo(() => engine.screen(source, { seed }), [engine, identity, seedKey])
  useEffect(() => {
    void screen.load()
    return () => screen.cancel()
  }, [screen])
  useSyncExternalStore(screen.subscribe, screen.getSnapshot, screen.getSnapshot)
  return screen
}

export function SduiScreen({ engine, source, seed, interactive = true, slots, onState, className, style }: SduiScreenProps) {
  const screen = useSduiScreen(engine, source, seed)
  const state = screen.loadState
  useEffect(() => { onState?.(state) }, [state, onState])
  const result = screen.render({ interactive, slots: slots ? Object.keys(slots) : undefined })
  return (
    <div className={className} style={style} data-sdui-screen={ScreenSource.identity(screen.source)}>
      {result.nodes.map((n) => <RenderNodeView key={n.key} node={n} screen={screen} slots={slots} />)}
      {result.overlays.map((n) => <RenderNodeView key={n.key} node={n} screen={screen} slots={slots} />)}
    </div>
  )
}

export default SduiScreen
