// @fajekrina/sdui/builder/vue — <SduiBuilder /> wraps the DOM Studio.
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { mountStudio, type MountedStudio, type StudioCatalog } from './studio'
import type { EditorDocument } from './document'
import type { ComponentFactory, SduiValue } from '../core'

export const SduiBuilder = defineComponent({
  name: 'SduiBuilder',
  props: {
    document: { type: Object as PropType<EditorDocument>, default: undefined },
    factory: { type: Object as PropType<ComponentFactory>, default: undefined },
    sampleData: { type: Object as PropType<Record<string, SduiValue>>, default: undefined },
    assetURL: { type: Function as PropType<(name: string) => string>, default: undefined },
    /// names offered by the action editor (the app's allow-lists; never URLs)
    screens: { type: Array as PropType<readonly string[]>, default: undefined },
    requests: { type: Array as PropType<readonly string[]>, default: undefined },
    links: { type: Array as PropType<readonly string[]>, default: undefined },
    commands: { type: Array as PropType<readonly string[]>, default: undefined },
    title: { type: String, default: undefined },
    /// the app's names: screens, requests, links, commands, assets (an explicit list wins)
    catalog: { type: Object as PropType<StudioCatalog>, default: undefined },
    /// view only (a reviewer role)
    readOnly: { type: Boolean, default: false },
    /// payload of the active release: the Studio lists the draft's changes against it
    baseline: { type: Object as PropType<unknown>, default: undefined },
    /// `adopt` (default, constructable stylesheet) or `external` (link studio.css yourself)
    stylesheet: { type: String as PropType<'adopt' | 'external'>, default: undefined },
    /// `@save` / `@publish` show the Save/Publish buttons; `@change` fires on every edit
    onSave: { type: Function as PropType<(payload: unknown) => void | Promise<void>>, default: undefined },
    onPublish: { type: Function as PropType<(payload: unknown) => void | Promise<void>>, default: undefined },
    /// `@submit-for-review` (payload, note): maker-checker instead of publishing directly
    onSubmitForReview: { type: Function as PropType<(payload: unknown, note: string) => void | Promise<void>>, default: undefined },
    onChange: { type: Function as PropType<(payload: unknown) => void>, default: undefined }
  },
  setup(props) {
    const host = ref<HTMLDivElement>()
    let studio: MountedStudio | undefined
    onMounted(() => {
      studio = mountStudio(host.value!, {
        document: props.document,
        factory: props.factory,
        sampleData: props.sampleData,
        assetURL: props.assetURL,
        screens: props.screens,
        requests: props.requests,
        links: props.links,
        commands: props.commands,
        title: props.title,
        catalog: props.catalog,
        readOnly: props.readOnly,
        baseline: props.baseline,
        stylesheet: props.stylesheet,
        onSave: props.onSave && ((p) => props.onSave?.(p)),
        onPublish: props.onPublish && ((p) => props.onPublish?.(p)),
        onSubmitForReview: props.onSubmitForReview && ((p, note) => props.onSubmitForReview?.(p, note)),
        onChange: (p) => props.onChange?.(p)
      })
    })
    // options that may arrive or change after mounting (lists loaded from a backend, the title)
    watch(() => [props.title, props.screens, props.requests, props.links, props.commands, props.catalog, props.readOnly, props.baseline, props.sampleData, props.assetURL], () => {
      studio?.update({
        title: props.title, screens: props.screens, requests: props.requests, links: props.links,
        commands: props.commands, catalog: props.catalog, readOnly: props.readOnly, baseline: props.baseline,
        sampleData: props.sampleData, assetURL: props.assetURL
      })
    })
    onBeforeUnmount(() => studio?.destroy())
    return () => h('div', { ref: host, style: { height: '100%' } })
  }
})

export default SduiBuilder
export * from './index'
