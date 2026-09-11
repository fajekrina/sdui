<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Fajrina from '../vue/Fajrina.vue'
import { createBuilderState, cssTextToStyle, styleToCssText } from './builder'
import { buildLayoutStyle } from '../core/style'
import type { FajrinaData, UniversalComponent } from '../core/types'
import { normalizeToLayout } from '../core/types'

const props = defineProps<{
  data?: FajrinaData
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

const state = createBuilderState(props.data)
const bump = ref(0)
const selectedId = ref<string | null>(null)
const jsonText = ref(JSON.stringify(state.toFlatArray(), null, 2))
const jsonError = ref<string | null>(null)
const status = ref('')

const comps = computed(() => { void bump.value; return state.toFlatArray() })
const selected = computed(() => comps.value.find(c => c.id === selectedId.value) ?? null)
const layoutData = computed(() => ({ layout: { components: comps.value } } as FajrinaData))

function refresh() {
  jsonText.value = JSON.stringify(state.toFlatArray(), null, 2)
  emit('change', { components: state.toFlatArray() })
  bump.value++
}
function add(type: string, parentId: string | null = null) {
  const c = state.add(type, parentId)
  selectedId.value = c.id
  refresh()
}
function patchSelected(patch: Record<string, unknown>) {
  if (!selected.value) return
  const cur = selected.value
  const merged = { ...(cur.props as object ?? {}), ...patch }
  state.patch(cur.id, { props: merged as Record<string, unknown> })
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
  try { const parsed = JSON.parse(v); if (!Array.isArray(parsed)) throw new Error('Harus array'); state.setComponents(parsed); jsonError.value = null; emit('change', { components: parsed }); bump.value++ } catch (e: unknown) { jsonError.value = (e as Error).message }
}
function doSave() { emit('save', { components: state.toFlatArray() }); status.value = 'Save...'; setTimeout(()=>status.value='',2000) }
function doPublish() { emit('publish', { components: state.toFlatArray() }); status.value='Publish...'; setTimeout(()=>status.value='',2000) }

watch(() => props.data, (v) => {
  const l = normalizeToLayout(v as FajrinaData ?? null)
  if (l?.components) { state.fromLayout(l); jsonText.value = JSON.stringify(state.toFlatArray(), null, 2); selectedId.value = null; bump.value++ }
})

function onPaletteDrag(e: DragEvent, type: string) { e.dataTransfer?.setData('text/plain', type) }
function onCanvasDrop(e: DragEvent) { e.preventDefault(); const t = e.dataTransfer?.getData('text/plain'); if (t) { e.stopPropagation(); add(t, null) } }

const PALETTE = ['Container','Flex','Grid','Heading','Text','Button','Card','Hero','Image','Input','Select','Textarea','Form','Link','Divider','Space']
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100vh;background:#0f1220;color:#e6e9f5;">
    <header style="height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;background:#1a1f35;border-bottom:1px solid #2c3354;flex-shrink:0;">
      <strong style="font-size:14px;">Fajrina Builder</strong>
      <span v-if="merchantId" style="font-size:12px;color:#9aa3c7;">{{ merchantId }}/{{ pageKey ?? '' }}</span>
      <span style="margin-left:auto;font-size:12px;color:#3ad29f;">{{ status }}</span>
      <button @click="doSave" style="height:28px;padding:0 12px;border-radius:6px;border:1px solid #3ad29f;background:#3ad29f;color:#0f1220;cursor:pointer;font-size:13px;">Save</button>
      <button @click="doPublish" style="height:28px;padding:0 12px;border-radius:6px;border:1px solid #f59e0b;background:#f59e0b;color:#fff;cursor:pointer;font-size:13px;">Publish</button>
    </header>

    <div style="flex:1;display:grid;grid-template-columns:220px 1fr 320px;overflow:hidden;">
      <aside style="background:#1a1f35;border-right:1px solid #2c3354;overflow:auto;padding:12px;">
        <div style="font-size:11px;color:#9aa3c7;margin-bottom:8px;">Drag ke canvas. Drop ke area kosong = root.</div>
        <div v-for="t in PALETTE" :key="t" draggable="true" @dragstart="(e:DragEvent)=>onPaletteDrag(e,t)" style="padding:8px 10px;border:1px solid #2c3354;border-radius:8px;background:#0f1220;margin-bottom:6px;cursor:grab;font-size:13px;">{{ t }}</div>
      </aside>

      <div style="overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px;" @dragover.prevent @drop="onCanvasDrop">
        <div id="fajrina-canvas-wrap" style="flex:1;background:#fff;color:#0f172a;border-radius:12px;border:1px solid #e2e8f0;min-height:520px;padding:16px;overflow:auto;" @dragover.prevent @drop="onCanvasDrop">
          <div v-if="comps.length===0" style="border:2px dashed #cbd5e1;border-radius:10px;padding:40px;text-align:center;color:#64748b;font-size:13px;">Canvas kosong — drag komponen dari palet kiri.</div>
          <template v-else>
            <Fajrina :data="layoutData as never" @action="()=>{}" />
            <div style="margin-top:12px;border-top:1px solid #e2e8f0;padding-top:8px;">
              <div v-for="c in comps" :key="c.id" :data-fid="c.id" @click="selectedId=c.id" :style="{padding:'4px 8px',border: c.id===selectedId?'1px solid #6c8cff':'1px solid transparent',background: c.id===selectedId?'rgba(108,140,255,.08)':'transparent',borderRadius:'6px',fontSize:'12px',cursor:'pointer',display:'flex',justifyContent:'space-between'}">
                <span>{{ (c.type ?? (c as unknown as Record<string,unknown>).component) as string }} • {{ c.id.slice(-6) }} • order:{{ c.order ?? 0 }}</span>
                <span style="color:#94a3b8;">{{ c.parentId ? 'child' : 'root' }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <aside style="background:#1a1f35;border-left:1px solid #2c3354;overflow:auto;padding:12px;">
        <h3 style="font-size:13px;margin:0 0 8px 0;">Properties</h3>
        <div v-if="!selected" style="font-size:12px;color:#9aa3c7;">Pilih komponen di canvas</div>
        <div v-else style="display:flex;flex-direction:column;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>id</span><input :value="selected.id" disabled style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>order</span><input type="number" :value="selected.order ?? 0" @change="(e:Event)=>{ const n=parseInt((e.target as HTMLInputElement).value); state.patch(selected!.id,{order:isNaN(n)?0:n} as unknown as Partial<UniversalComponent>); refresh() }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>parentId</span><input :value="selected.parentId ?? ''" placeholder="(root)" @change="(e:Event)=>{ state.patch(selected!.id,{parentId:(e.target as HTMLInputElement).value||null} as unknown as Partial<UniversalComponent>); refresh() }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>

          <template v-if="String(selected.type ?? (selected as unknown as Record<string,unknown>).component) === 'Heading'">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>content</span><input :value="String((selected.props as Record<string,unknown>)?.content ?? '')" @change="(e:Event)=>patchSelected({content:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>level</span><select :value="String((selected.props as Record<string,unknown>)?.level ?? 2)" @change="(e:Event)=>patchSelected({level:parseInt((e.target as HTMLSelectElement).value)})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label>
          </template>
          <template v-if="String(selected.type ?? (selected as unknown as Record<string,unknown>).component) === 'Text'">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>content</span><textarea :value="String((selected.props as Record<string,unknown>)?.content ?? (selected.props as Record<string,unknown>)?.text ?? '')" @change="(e:Event)=>patchSelected({content:(e.target as HTMLTextAreaElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;min-height:60px;"></textarea></label>
          </template>
          <template v-if="String(selected.type ?? (selected as unknown as Record<string,unknown>).component) === 'Button'">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>label</span><input :value="String((selected.props as Record<string,unknown>)?.label ?? '')" @change="(e:Event)=>patchSelected({label:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
          </template>
          <template v-if="['Input','Select','Textarea'].includes(String(selected.type ?? (selected as unknown as Record<string,unknown>).component))">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>name</span><input :value="String((selected.props as Record<string,unknown>)?.name ?? '')" @change="(e:Event)=>patchSelected({name:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
          </template>
          <template v-if="String(selected.type ?? (selected as unknown as Record<string,unknown>).component) === 'Image'">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>src</span><input :value="String((selected.props as Record<string,unknown>)?.src ?? '')" @change="(e:Event)=>patchSelected({src:(e.target as HTMLInputElement).value})" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:12px;" /></label>
          </template>

          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>props (JSON)</span><textarea :value="JSON.stringify(selected.props ?? {}, null, 2)" @change="(e:Event)=>{ try{ const p=JSON.parse((e.target as HTMLTextAreaElement).value); state.patch(selected!.id,{props:p} as Partial<UniversalComponent>); refresh() } catch{} }" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:11px;min-height:80px;font-family:monospace;"></textarea></label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3c7;"><span>Style (CSS)</span><textarea :value="styleToCssText(selected.style as Record<string,unknown>)" @change="(e:Event)=>patchStyle((e.target as HTMLTextAreaElement).value)" style="width:100%;background:#0f1220;border:1px solid #2c3354;color:#e6e9f5;border-radius:6px;padding:6px 8px;font-size:11px;min-height:80px;font-family:monospace;" placeholder="background-color: #fff;"></textarea></label>
          <div style="font-size:11px;color:#9aa3c7;border:1px solid #2c3354;border-radius:6px;padding:8px;"><div style="font-weight:600;margin-bottom:4px;">Style preview</div><pre style="margin:0;white-space:pre-wrap;font-size:10px;">{{ JSON.stringify(buildLayoutStyle(String(selected.type ?? ''),(selected.props as Record<string,unknown> ?? {}),(selected.style as Record<string,string> ?? {})),null,2) }}</pre></div>
          <div style="display:flex;gap:6px;">
            <button @click="()=>{ state.duplicate(selected!.id); selectedId=state.get().selectedId; refresh() }" style="flex:1;height:28px;border-radius:6px;border:1px solid #2c3354;background:#0f1220;color:#e6e9f5;cursor:pointer;">Duplicate</button>
            <button @click="()=>{ state.remove(selected!.id); selectedId=null; refresh() }" style="flex:1;height:28px;border-radius:6px;border:1px solid #ff6b6b;background:transparent;color:#ff6b6b;cursor:pointer;">Delete</button>
          </div>
        </div>
      </aside>
    </div>

    <div style="height:220px;background:#1a1f35;border-top:1px solid #2c3354;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#232a45;border-bottom:1px solid #2c3354;"><span style="font-size:12px;color:#9aa3c7;">JSON — flat array (2-way sync)</span><button @click="()=>{ try{ jsonText=JSON.stringify(JSON.parse(jsonText),null,2) } catch{} }" style="margin-left:auto;height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid #2c3354;background:#0f1220;color:#e6e9f5;cursor:pointer;">Format</button></div>
      <textarea :value="jsonText" @input="(e:Event)=>onJsonEdit((e.target as HTMLTextAreaElement).value)" spellcheck="false" style="flex:1;background:#0f1220;color:#e6e9f5;border:0;padding:10px;font-family:monospace;font-size:12px;resize:none;outline:none;"></textarea>
      <div v-if="jsonError" style="font-size:11px;color:#ff6b6b;padding:4px 8px;">{{ jsonError }}</div>
    </div>
  </div>
</template>
