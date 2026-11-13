// @fajekrina/sdui/builder/react — <SduiBuilder /> wraps the DOM Studio.
import React, { useEffect, useRef } from 'react'
import { mountStudio, type MountedStudio, type StudioOptions } from './studio'

export interface SduiBuilderProps extends StudioOptions {
  className?: string
  style?: React.CSSProperties
}

export function SduiBuilder({ className, style, ...options }: SduiBuilderProps) {
  const host = useRef<HTMLDivElement>(null)
  const studio = useRef<MountedStudio>()
  const optionsRef = useRef(options)
  optionsRef.current = options
  useEffect(() => {
    if (!host.current) return
    studio.current = mountStudio(host.current, {
      ...optionsRef.current,
      onSave: optionsRef.current.onSave && ((p) => optionsRef.current.onSave?.(p)),
      onPublish: optionsRef.current.onPublish && ((p) => optionsRef.current.onPublish?.(p)),
      onSubmitForReview: optionsRef.current.onSubmitForReview && ((p, note) => optionsRef.current.onSubmitForReview?.(p, note)),
      onChange: (p) => optionsRef.current.onChange?.(p)
    })
    return () => { studio.current?.destroy(); studio.current = undefined }
  }, [options.document])
  // options that may arrive or change after mounting (lists, the title, the reviewer
  // role, a new active release after publishing)
  const { title, screens, requests, links, commands, catalog, readOnly, baseline, sampleData, assetURL } = options
  useEffect(() => {
    studio.current?.update({ title, screens, requests, links, commands, catalog, readOnly, baseline, sampleData, assetURL })
  }, [title, screens, requests, links, commands, catalog, readOnly, baseline, sampleData, assetURL])
  return <div ref={host} className={className} style={{ height: '100%', ...style }} />
}

export default SduiBuilder
export * from './index'
