<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Fajrina from '../vue/Fajrina.vue'
import BuilderNode from './BuilderNode.vue'
import { createBuilderState, cssTextToStyle, styleToCssText, genId } from './builder'
import { buildLayoutStyle } from '../core/style'
import { buildTree, type TreeNode } from '../core/tree'
import { getComponentType } from '../core/types'
import type { FajrinaData, UniversalComponent } from '../core/types'
import { normalizeToLayout } from '../core/types'

export type RegistryComponents = Record<string, { props?: Record<string, unknown> }>

const props = defineProps<{
  data?: FajrinaData
  registry?: RegistryComponents
  pages?: string[]
  modals?: { id: string }[]
  merchantId?: string
  pageKey?: string
  modelValue?: unknown
}>()
const emit = defineEmits<{
  (e: 'save', payload: { components: UniversalComponent[] }): void
  (e: 'publish', payload: { components: UniversalComponent[] }): void
  (e: 'change', payload: { components: UniversalComponent[] }): void
  (e: 'update:modelValue', v: unknown): void
}>()

const FALLBACK_ORDER = ['Container','Heading','Text','Button','Image','Input','Select','Textarea','Form','Link','Flex','Grid','Card','Hero','Divider','Space','Modal']
function paletteOrder(reg?: RegistryComponents): string[] {
  const keys = reg ? Object.keys(reg) : FALLBACK_ORDER
  const ordered = FALLBACK_ORDER.filter(k => keys.includes(k))
  const rest = keys.filter(k => !ordered.includes(k))
  return [...ordered, ...rest]
}
function dotColor(t: string) {
  if (t==='Container') return '#6c8cff'
  if (t==='Heading') return '#f59e0b'
  if (t==='Button') return '#3ad29f'
  if (t==='Modal') return '#f472b6'
  if (['Input','Select','Textarea','Form'].includes(t)) return '#a78bfa'
  return '#232a45'
}

const state = createBuilderState(props.data)
const bump = ref(0)
const selectedId = ref<string | null>(null)
const jsonText = ref(JSON.stringify(state.toFlatArray(), null, 2))
const jsonError = ref<string | null>(null)
const status = ref('')
const dragOverId = ref<string | null>(null)
const lastEmittedRef = ref<string | null>(null)

const comps = computed(() => { void bump.value; return state.toFlatArray() })
const selected = computed(() => comps.value.find(c => c.id === selectedId.value) ?? null)
const palette = computed(() => paletteOrder(props.registry))
const tree = computed(() => { void bump.value; return buildTree(comps.value) })
const layoutData = computed(() => ({ layout: { components: comps.value } } as FajrinaData))
const internalModals = computed(()=> comps.value.filter(c=>getComponentType(c as UniversalComponent)==='Modal').map(c=>({id:c.id})))
const effectivePages = computed(()=> props.pages ?? ['home'])
const effectiveModals = computed(()=> (props.modals && props.modals.length ? props.modals : internalModals.value) as {id:string}[])

function refresh() {
  lastEmittedRef.value = state.toFlatArray().map(c=>c.id).sort().join(',')
  jsonText.value = JSON.stringify(state.toFlatArray(), null, 2)
  emit('change', { components: state.toFlatArray() })
  bump.value++
}
function add(type: string, parentId: string | null = null) {
  const def = props.registry?.[type]?.props as Record<string, unknown> | undefined
  const defaults: Record<string, unknown> = {}
  if (def) { for (const [k,v] of Object.entries(def)) { if (Array.isArray(v) && v.length) defaults[k]=v[0]; else if (typeof v==='object' && v!==null && 'default' in (v as Record<string,unknown>)) defaults[k]=(v as Record<string,unknown>).default; else if (typeof v==='string'||typeof v==='number'||typeof v==='boolean') defaults[k]=v } }
  if (type==='Heading' && !defaults.content) defaults.content='Heading'
  if (type==='Text' && !defaults.content) defaults.content='Text'
  if (type==='Button' && !defaults.label) defaults.label='Button'
  if (type==='Image' && !defaults.src) defaults.src='https://picsum.photos/400/200'
  if ((type==='Input'||type==='Select'||type==='Textarea') && !defaults.name) defaults.name=type.toLowerCase()+'_'+Math.random().toString(36).slice(2,5)
  const added = state.add(type, parentId)
  state.patch(added.id, { props: defaults, component: type } as Partial<UniversalComponent>)
  selectedId.value = added.id
  refresh()
}
function patchSelected(patch: Record<string, unknown>) {
  if (!selected.value) return
  const merged = { ...(selected.value.props as object ?? {}), ...patch }
  state.patch(selected.value.id, { props: merged as Record<string, unknown> })
  refresh()
}
function updateAction(behavior: string, extra: Record<string, unknown> = {}) {
  if (!selected.value) return
  const curA = ((selected.value.props as Record<string,unknown>)?.action as Record<string,unknown> ?? (selected.value as unknown as Record<string,unknown>).action as Record<string,unknown> ?? {}) as Record<string,unknown>
  const base: Record<string, unknown> = { ...curA, behavior, ...extra }
  const keep: Record<string,string[]> = { navigate:['behavior','target','params'], submit:['behavior','target','modalId','params'], externalLink:['behavior','href','target'], openModal:['behavior','modalId','title','message'], closeModal:['behavior','modalId'], toast:['behavior','message'], customEvent:['behavior','eventName','params'], back:['behavior'] }
  const allowed = keep[behavior] ?? ['behavior','target','href','modalId','message','eventName','params']
  for (const k of Object.keys(base)) if (!allowed.includes(k)) delete base[k]
  const { behavior: _b, target: _t, href: _h, modalId: _m, message: _msg, eventName: _e, params: _p, action: _a, ...restProps } = selected.value.props as Record<string,unknown>
  state.patch(selected.value.id, { props: { ...restProps, action: base } as Record<string,unknown>, action: base as unknown as UniversalComponent['action'] })
  refresh()
}
function patchStyle(css: string) {
  if (!selected.value) return
  const { style, error } = cssTextToStyle(css)
  jsonError.value = error
  if (!error) { state.patch(selected.value.id, { style } as Partial<UniversalComponent>); refresh() }
}
function onJsonEdit(v: string) {
  jsonText.value = v
  try { const parsed = JSON.parse(v); if (!Array.isArray(parsed)) throw new Error('Harus array'); parsed.forEach((c: Record<string,unknown>, i:number)=>{ if(!c.id || (!c.type && !c.component)) throw new Error(`Item ${i} missing id/type`)}); lastEmittedRef.value = parsed.map((c: Record<string,unknown>)=> String(c.id)).sort().join(','); state.setComponents(parsed); jsonError.value = null; emit('change', { components: parsed }); bump.value++ } catch (e: unknown) { jsonError.value = (e as Error).message }
}
function doSave() { emit('save', { components: state.toFlatArray() }); status.value = 'Save...'; setTimeout(()=>status.value='',2000) }
function doPublish() { emit('publish', { components: state.toFlatArray() }); status.value='Publish...'; setTimeout(()=>status.value='',2000) }

watch(() => props.data, (v) => {
  const l = normalizeToLayout(v as FajrinaData ?? null)
  if (!l?.components) return
  const incomingKey = l.components.map(c=>c.id).sort().join(',')
  if (lastEmittedRef.value && incomingKey === lastEmittedRef.value) return
  state.fromLayout(l); jsonText.value = JSON.stringify(state.toFlatArray(), null, 2)
  const stillExists = l.components.some(c=>c.id===selectedId.value)
  if (!stillExists) selectedId.value = null
  bump.value++
})

function onPaletteDrag(e: DragEvent, type: string) { e.dataTransfer?.setData('text/plain', type) }
function onCanvasDrop(e: DragEvent) { e.preventDefault(); const t = e.dataTransfer?.getData('text/plain'); if (t) add(t, null) }
function onNodeDragOver(e: DragEvent, id: string) { const t=getComponentType(comps.value.find(c=>c.id===id) as UniversalComponent); if(['Container','Form'].includes(t)){ e.preventDefault(); e.stopPropagation(); dragOverId.value=id } }
function onNodeDrop(e: DragEvent, id: string) { e.preventDefault(); e.stopPropagation(); dragOverId.value=null; const t=e.dataTransfer?.getData('text/plain'); if(t) add(t, id) }
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100vh;background:#0f1220;color:#e6e9f5;">
    <header style="height:52px;display:flex;align-items:center;gap:8px;padding:0 12px;background:#1a1f35;border-bottom:1px solid #2c3354;flex-shrink:0;">
      <strong style="font-size:14px;">Fajrina Builder</strong>
      <span v-if="merchantId" style="font-size:12px;color:#9aa3c7;">{{ merchantId }}/{{ pageKey ?? '' }}</span>
      <span style="margin-left:auto;font-size:12px;color:#3ad29f;">{{ status }}</span>
      <button @click="doSave" style="height:28px;padding:0 12px;border-radius:6px;border:1px solid #3ad29f;background:#3ad29f;color:#0f1220;cursor:pointer;font-size:13px;">Save</button>
      <button @click="doPublish" style="height:28px;padding:0 12px;border-radius:6px;border:1px solid #f59e0b;background:#f59e0b;color:#fff;cursor:pointer;font-size:13px;">Publish</button>
    </header>

    <div style="flex:1;display:grid;grid-template-columns:260px 1fr 340px;overflow:hidden;">
      <aside style="background:#1a1f35;border-right:1px solid #2c3354;overflow:auto;padding:12px;">
        <h2 style="font-size:12px;letter-spacing:.08em;color:#9aa3c7;margin:8px 0 6px;text-transform:uppercase;">Palette</h2>
        <div style="font-size:11px;color:#9aa3c7;margin-bottom:8px;">Drag ke canvas. Drop ke Container untuk jadi child.</div>
        <div v-for="t in palette" :key="t" draggable="true" @dragstart="(e:DragEvent)=>onPaletteDrag(e,t)" style="padding:10px;border:1px solid #2c3354;border-radius:8px;background:#0f1220;margin-bottom:8px;cursor:grab;display:flex;align-items:center;gap:8px;font-size:13px;">
          <span :style="{width:'22px',height:'22px',borderRadius:'6px',background:dotColor(t),display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'10px',color:'#fff'}">{{ t[0] }}</span>
          <span>{{ t }}</span>
          <small style="color:#9aa3c7;font-size:11px;margin-left:auto;">{{ registry?.[t]?.props ? Object.keys(registry[t].props as object).slice(0,3).join(', ') : '' }}</small>
        </div>
      </aside>

      <div style="overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px;">
        <div id="fajrina-canvas-wrap" style="flex:1;background:#fff;color:#0f172a;border-radius:12px;border:1px solid #e2e8f0;min-height:520px;padding:24px;overflow:auto;" @dragover.prevent @drop="(e:DragEvent)=>{ e.preventDefault(); e.stopPropagation(); const t=e.dataTransfer?.getData('text/plain'); if(t) add(t,null) }" @click="selectedId=null">
          <div v-if="comps.length===0" style="border:2px dashed #cbd5e1;border-radius:10px;padding:40px;text-align:center;color:#64748b;font-size:13px;">Canvas kosong — drag komponen dari palet kiri ke sini.<br/>Drop ke area kosong = root, drop ke Container/Form = child.</div>
          <template v-else>
            <BuilderNode v-for="node in tree" :key="node.id" :node="node as never" :selectedId="selectedId" :dragOverId="dragOverId" @select="selectedId=$event" @dragover="dragOverId=$event" @drop="(p)=>add(p.type,p.id)" />
          </template>
        </div>
        <div style="display:none;"><Fajrina :data="layoutData as never" @action="()=>{}" /></div>
      </div>

      <aside style="background:#1a1f35;border-left:1px solid #2c3354;overflow:auto;padding:12px;">
        <h3 style="font-size:13px;margin:0 0 8px 0;">Properties</h3>
        <div v-if="!selected" style="font-size:12px;color:#9aa3c7;">Pilih komponen di canvas</div>
        <div v-else style="display:flex;flex-direction:column;gap:10px;">
          <div style="border:1px solid #2c3354;border-radius:8px;overflow:hidden;">
            <h3 style="font-size:11px;letter-spacing:.06em;color:#9aa3c7;background:#232a45;padding:6px 8px;text-transform:uppercase;">Identity</h3>
            <div style="padding:8px;display:flex;flex-direction:column;gap:8px;">
              <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>id</span><input :value="selected.id" disabled style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>order</span><input type="number" :value="selected.order ?? 0" @change="(e:Event)=>{ const n=parseInt((e.target as HTMLInputElement).value); state.patch(selected!.id,{order:isNaN(n)?0:n} as unknown as Partial<UniversalComponent>); refresh() }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>parentId</span><select :value="selected.parentId ?? ''" @change="(e:Event)=>{ state.patch(selected!.id,{parentId:(e.target as HTMLSelectElement).value||null} as unknown as Partial<UniversalComponent>); refresh() }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="">(root)</option><option v-for="c in comps.filter(c=>c.id!==selected!.id && ['Container','Form'].includes(getComponentType(c)))" :key="c.id" :value="c.id">{{ getComponentType(c) }} • {{ c.id.slice(-6) }}</option></select></label>
            </div>
          </div>

          <div style="border:1px solid #2c3354;border-radius:8px;overflow:hidden;">
            <h3 style="font-size:11px;letter-spacing:.06em;color:#9aa3c7;background:#232a45;padding:6px 8px;text-transform:uppercase;">Props</h3>
            <div style="padding:8px;display:flex;flex-direction:column;gap:8px;">
              <template v-if="getComponentType(selected)==='Heading'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>content</span><input :value="String((selected.props as Record<string,unknown>)?.content ?? '')" @input="(e:Event)=>patchSelected({content:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>level</span><select :value="String((selected.props as Record<string,unknown>)?.level ?? 2)" @input="(e:Event)=>patchSelected({level:parseInt((e.target as HTMLSelectElement).value)})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label>
              </template>
              <template v-if="getComponentType(selected)==='Text'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>content</span><textarea :value="String((selected.props as Record<string,unknown>)?.content ?? (selected.props as Record<string,unknown>)?.text ?? '')" @input="(e:Event)=>patchSelected({content:(e.target as HTMLTextAreaElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;min-height:60px;"></textarea></label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>tag</span><select :value="String((selected.props as Record<string,unknown>)?.tag ?? 'p')" @input="(e:Event)=>patchSelected({tag:(e.target as HTMLSelectElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option>p</option><option>span</option><option>label</option></select></label>
              </template>
              <template v-if="getComponentType(selected)==='Button'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>label</span><input :value="String((selected.props as Record<string,unknown>)?.label ?? '')" @input="(e:Event)=>patchSelected({label:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>action.behavior</span><select :value="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior ?? 'navigate')" @change="(e:Event)=>updateAction((e.target as HTMLSelectElement).value)" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option>navigate</option><option>submit</option><option>externalLink</option><option>back</option><option>openModal</option><option>closeModal</option><option>toast</option><option>customEvent</option></select></label>
                <template v-if="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior ?? 'navigate')==='navigate'">
                  <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>target (page)</span><select :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.target ?? (selected as unknown as Record<string,unknown>).action?.target ?? ''))" @change="(e:Event)=>updateAction('navigate',{target:(e.target as HTMLSelectElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="">-- pilih page --</option><option v-for="p in effectivePages" :key="p" :value="p">{{ p }}</option></select></label>
                </template>
                <template v-else-if="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior)==='externalLink'">
                  <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>href</span><input :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.href ?? ''))" @input="(e:Event)=>updateAction('externalLink',{href:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" placeholder="https://example.com" /></label>
                </template>
                <template v-else-if="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior)==='openModal'">
                  <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>modalId</span><select :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.modalId ?? ''))" @change="(e:Event)=>updateAction('openModal',{modalId:(e.target as HTMLSelectElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="">-- pilih Modal --</option><option v-for="m in effectiveModals" :key="m.id" :value="m.id">{{ m.id.slice(-6) }}</option><option v-if="!effectiveModals.length" disabled>Belum ada Modal — buat komponen Modal dulu</option></select></label>
                </template>
                <template v-else-if="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior)==='submit'">
                  <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>On success</span><select :value="((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.modalId ?? (selected as unknown as Record<string,unknown>).action?.modalId) ? 'openModal' : 'navigate')" @change="(e:Event)=>{ const v=(e.target as HTMLSelectElement).value; if(v==='openModal') updateAction('submit',{modalId: (effectiveModals[0]?.id ?? ''), target: undefined}); else updateAction('submit',{target: (effectivePages[0] ?? 'home'), modalId: undefined}) }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="navigate">Redirect to page</option><option value="openModal">Open modal</option></select></label>
                  <template v-if="(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.modalId ?? (selected as unknown as Record<string,unknown>).action?.modalId)">
                    <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>modalId</span><select :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.modalId ?? ''))" @change="(e:Event)=>updateAction('submit',{modalId:(e.target as HTMLSelectElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="">-- pilih Modal --</option><option v-for="m in effectiveModals" :key="m.id" :value="m.id">{{ m.id.slice(-6) }}</option><option v-if="!effectiveModals.length" disabled>Belum ada Modal — buat komponen Modal dulu</option></select></label>
                  </template>
                  <template v-else>
                    <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>target (page)</span><select :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.target ?? (selected as unknown as Record<string,unknown>).action?.target ?? ''))" @change="(e:Event)=>updateAction('submit',{target:(e.target as HTMLSelectElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="">-- pilih page --</option><option v-for="p in effectivePages" :key="p" :value="p">{{ p }}</option></select></label>
                  </template>
                </template>
                <template v-else-if="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior)==='toast'">
                  <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>message</span><textarea :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.message ?? ''))" @input="(e:Event)=>updateAction('toast',{message:(e.target as HTMLTextAreaElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;min-height:50px;"></textarea></label>
                </template>
                <template v-else-if="String(((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.behavior ?? (selected as unknown as Record<string,unknown>).action?.behavior)==='customEvent'">
                  <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>eventName</span><input :value="String((((selected.props as Record<string,unknown>)?.action as Record<string,unknown>)?.eventName ?? ''))" @input="(e:Event)=>updateAction('customEvent',{eventName:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
                </template>
              </template>
              <template v-if="['Input','Select','Textarea'].includes(getComponentType(selected))">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>name</span><input :value="String((selected.props as Record<string,unknown>)?.name ?? '')" @input="(e:Event)=>patchSelected({name:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              </template>
              <template v-if="getComponentType(selected)==='Image'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>src</span><input :value="String((selected.props as Record<string,unknown>)?.src ?? '')" @input="(e:Event)=>patchSelected({src:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              </template>
              <template v-if="['Input','Select','Textarea','Link'].includes(getComponentType(selected))">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>placeholder</span><input :value="String((selected.props as Record<string,unknown>)?.placeholder ?? '')" @input="(e:Event)=>patchSelected({placeholder:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>required</span><select :value="String(Boolean((selected.props as Record<string,unknown>)?.required))" @input="(e:Event)=>patchSelected({required:(e.target as HTMLSelectElement).value==='true'})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="false">false</option><option value="true">true</option></select></label>
              </template>
              <template v-if="getComponentType(selected)==='Link'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>label</span><input :value="String((selected.props as Record<string,unknown>)?.label ?? '')" @input="(e:Event)=>patchSelected({label:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>href</span><input :value="String((selected.props as Record<string,unknown>)?.href ?? '')" @input="(e:Event)=>patchSelected({href:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              </template>
              <template v-if="getComponentType(selected)==='Flex'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>direction</span><select :value="String((selected.props as Record<string,unknown>)?.direction ?? 'row')" @input="(e:Event)=>patchSelected({direction:(e.target as HTMLSelectElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option>row</option><option>column</option></select></label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>gap</span><input :value="String((selected.props as Record<string,unknown>)?.gap ?? 'md')" @input="(e:Event)=>patchSelected({gap:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              </template>
              <template v-if="getComponentType(selected)==='Grid'">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>columns</span><input type="number" :value="String((selected.props as Record<string,unknown>)?.columns ?? 2)" @input="(e:Event)=>patchSelected({columns:parseInt((e.target as HTMLInputElement).value)||2})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
              </template>
              <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>props (JSON)</span><textarea :value="JSON.stringify({ ...(selected.props ?? {}), ...((selected as unknown as Record<string,unknown>).action ? {action:(selected as unknown as Record<string,unknown>).action} : {}) }, null, 2)" @input="(e:Event)=>{ try{ const p=JSON.parse((e.target as HTMLTextAreaElement).value) as Record<string,unknown>; const act=p.action as Record<string,unknown>|undefined; const rest={...p}; delete rest.action; state.patch(selected!.id,{props:{...(selected.props as object ?? {}),...rest,...(act?{action:act}:{})} as Record<string,unknown>, ...(act?{action: act as unknown as UniversalComponent['action']}:{})}); refresh() } catch{} }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:11px;min-height:70px;font-family:monospace;"></textarea></label>
            </div>
          </div>

          <div style="border:1px solid #2c3354;border-radius:8px;overflow:hidden;">
            <h3 style="font-size:11px;letter-spacing:.06em;color:#9aa3c7;background:#232a45;padding:6px 8px;text-transform:uppercase;">Style (CSS)</h3>
            <div style="padding:8px;">
              <textarea :value="styleToCssText(selected.style as Record<string,unknown>)" @input="(e:Event)=>patchStyle((e.target as HTMLTextAreaElement).value)" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:11px;min-height:80px;font-family:monospace;" placeholder="background-color: #fff;"></textarea>
              <div style="font-size:11px;color:#9aa3c7;border:1px solid #2c3354;border-radius:6px;padding:8px;margin-top:6px;"><div style="font-weight:600;margin-bottom:4px;">Style preview (keep netral putih)</div><pre style="margin:0;white-space:pre-wrap;font-size:10px;">{{ JSON.stringify(buildLayoutStyle(getComponentType(selected),(selected.props as Record<string,unknown> ?? {}),(selected.style as Record<string,string> ?? {})),null,2) }}</pre></div>
            </div>
          </div>

          <div style="display:flex;gap:6px;">
            <button @click="()=>{ state.duplicate(selected!.id); selectedId=state.get().selectedId; refresh() }" style="flex:1;height:28px;border-radius:6px;border:1px solid #2c3354;background:#0f1220;color:#e6e9f5;cursor:pointer;">Duplicate</button>
            <button @click="()=>{ state.remove(selected!.id); selectedId=null; refresh() }" style="flex:1;height:28px;border-radius:6px;border:1px solid #ff6b6b;background:transparent;color:#ff6b6b;cursor:pointer;">Delete</button>
          </div>
        </div>
      </aside>
    </div>

    <div style="height:260px;background:#1a1f35;border-top:1px solid #2c3354;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#232a45;border-bottom:1px solid #2c3354;"><span style="font-size:12px;color:#9aa3c7;">JSON — flat array (2-way sync)</span><button @click="()=>{ try{ jsonText=JSON.stringify(JSON.parse(jsonText),null,2) } catch{} }" style="margin-left:auto;height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid #2c3354;background:#0f1220;color:#e6e9f5;cursor:pointer;">Format</button></div>
      <textarea :value="jsonText" @input="(e:Event)=>onJsonEdit((e.target as HTMLTextAreaElement).value)" spellcheck="false" style="flex:1;background:#0f1220;color:#e6e9f5;border:0;padding:10px;font-family:monospace;font-size:12px;resize:none;outline:none;"></textarea>
      <div v-if="jsonError" style="font-size:11px;color:#ff6b6b;padding:4px 8px;">{{ jsonError }}</div>
    </div>
  </div>
</template>
