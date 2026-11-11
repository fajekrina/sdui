// @fajekrina/sdui/builder/react — <SduiBuilder /> wraps the DOM Studio.
import React, { useEffect, useRef } from 'react'
import { mountStudio, type MountedStudio, type StudioOptions } from './studio'

export interface SduiBuilderProps extends StudioOptions {
  className?: string
  style?: React.CSSProperties
}

export function SduiBuilder({ className, style, ...options }: SduiBuilderProps) {
  const host = useRef<HTMLDivElement>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  useEffect(() => {
    if (!host.current) return
    const studio: MountedStudio = mountStudio(host.current, {
      ...optionsRef.current,
      onSave: optionsRef.current.onSave && ((p) => optionsRef.current.onSave?.(p)),
      onPublish: optionsRef.current.onPublish && ((p) => optionsRef.current.onPublish?.(p)),
      onChange: (p) => optionsRef.current.onChange?.(p)
    })
    return () => studio.destroy()
  }, [options.document])
  return <div ref={host} className={className} style={{ height: '100%', ...style }} />
}

export default SduiBuilder
export * from './index'
