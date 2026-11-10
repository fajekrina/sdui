<script setup lang="ts">
import { computed } from 'vue'
import { getComponentType } from '../core/types'
import { buildLayoutStyle } from '../core/style'
import { previewNode } from './builder'
import { SduiNodeView } from '../vue/SduiNode'
import type { UniversalComponent } from '../core/types'

const props = defineProps<{
  node: UniversalComponent & { children: UniversalComponent[] }
  selectedId: string | null
  dragOverId: string | null
}>()
const emit = defineEmits<{ (e: 'select', id: string): void; (e: ' dragover', id: string): void; (e: 'drop', payload: { id: string, type: string }): void }>()

const t = computed(() => getComponentType(props.node))
const isContainer = computed(() => ['Container','Form','Flex','Grid','Card','Hero'].includes(t.value))
const preview = computed(() => previewNode(props.node))
const leafStyle = computed(() => buildLayoutStyle(t.value, (props.node.props as Record<string,unknown> ?? {}), (props.node.style as Record<string,string> ?? {})) as Record<string,string>)
</script>

<template>
  <div :data-fid="node.id"
    :style="{ position:'relative', border: selectedId===node.id ? '1px solid #6c8cff' : (isContainer ? '1px dashed #cbd5e1' : '1px solid transparent'), borderRadius:'8px', padding:'4px', background: selectedId===node.id ? 'rgba(108,140,255,.06)' : 'transparent', outline: dragOverId===node.id ? '2px dashed #6c8cff' : undefined, outlineOffset:'-2px', marginBottom:'4px'}"
    @click.stop="$emit('select', node.id)"
    @dragover="(e:DragEvent)=>{ if(isContainer){ e.preventDefault(); e.stopPropagation(); $emit('dragover', node.id)} }"
    @dragleave="$emit('dragover','')"
    @drop="(e:DragEvent)=>{ e.preventDefault(); e.stopPropagation(); const ty=e.dataTransfer?.getData('text/plain'); if(ty) $emit('drop',{id:node.id, type:ty}) }">
    <div style="font-size:11px;color:#64748b;display:flex;justify-content:space-between;"><span>{{ t }} • {{ node.id.slice(-6) }} • order:{{ node.order }}</span><span style="font-size:10px;">{{ (node as unknown as Record<string,unknown>).parentId?'child':'root' }}</span></div>

    <template v-if="isContainer">
      <div :style="leafStyle">
        <div v-if="!(node.children ?? []).length" style="font-size:12px;color:#94a3b8;padding:8px;text-align:center;border:1px dashed #cbd5e1;border-radius:6px;">Empty {{ t }} — drop here</div>
        <BuilderNode v-for="ch in (node.children as unknown as (UniversalComponent & {children:UniversalComponent[]})[])" :key="ch.id" :node="ch as never" :selectedId="selectedId" :dragOverId="dragOverId" @select="$emit('select', $event)" @dragover="$emit('dragover',$event)" @drop="$emit('drop',$event)" />
      </div>
    </template>
    <template v-else>
      <!-- leaf preview = the client renderer (core view-model) -->
      <div :style="t==='Space' ? { background:'#e2e8f0', border:'1px dashed #cbd5e1' } : undefined">
        <SduiNodeView v-if="preview" :node="preview" />
        <div v-else style="font-size:12px;color:#b45309;">Unsupported {{ t }}</div>
      </div>
      <div v-if="(node.children ?? []).length" style="margin-top:4px;">
        <BuilderNode v-for="ch in (node.children as unknown as (UniversalComponent & {children:UniversalComponent[]})[])" :key="ch.id" :node="ch as never" :selectedId="selectedId" :dragOverId="dragOverId" @select="$emit('select',$event)" @dragover="$emit('dragover',$event)" @drop="$emit('drop',$event)" />
      </div>
    </template>
  </div>
</template>
