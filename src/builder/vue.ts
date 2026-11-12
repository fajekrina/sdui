// @fajekrina/sdui/builder/vue — <SduiBuilder /> wraps the DOM Studio.
import { defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType } from 'vue'
import { mountStudio, type MountedStudio } from './studio'
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
    /// `@save` / `@publish` show the Save/Publish buttons; `@change` fires on every edit
    onSave: { type: Function as PropType<(payload: unknown) => void | Promise<void>>, default: undefined },
    onPublish: { type: Function as PropType<(payload: unknown) => void | Promise<void>>, default: undefined },
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
        onSave: props.onSave && ((p) => props.onSave?.(p)),
        onPublish: props.onPublish && ((p) => props.onPublish?.(p)),
        onChange: (p) => props.onChange?.(p)
      })
    })
    onBeforeUnmount(() => studio?.destroy())
    return () => h('div', { ref: host, style: { height: '100%' } })
  }
})

export default SduiBuilder
export * from './index'
