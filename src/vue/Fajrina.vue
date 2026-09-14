<script setup lang="ts">
import { computed, ref } from 'vue'
import { normalizeToLayout, getComponentType, type FajrinaData, type FajrinaActionEvent, type UniversalComponent } from '../core/types'
import { buildLayoutStyle } from '../core/style'
import { buildTree } from '../core/tree'

const props = defineProps<{
  data: FajrinaData
  modelValue?: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'action', payload: FajrinaActionEvent): void
  (e: 'update:modelValue', v: Record<string, string>): void
}>()

const rawLayout = computed(() => normalizeToLayout(props.data as FajrinaData))
const layout = computed(() => {
  const l = rawLayout.value
  if (!l || !l.components) return l
  const hasParentId = l.components.some((c) => (c as UniversalComponent).parentId != null)
  if (hasParentId) {
    const roots = buildTree(l.components as UniversalComponent[])
    return { ...l, components: roots as unknown as UniversalComponent[] }
  }
  return l
})

function getType(comp: UniversalComponent): string {
  return getComponentType(comp)
}

// Toast & Modal state (behavior-driven, generik)
const toastMsg = ref<string | null>(null)
const modalInfo = ref<{ id?: string; title?: string; message?: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string) {
  toastMsg.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = null), 2500)
}
function openModal(info: { id?: string; title?: string; message?: string }) {
  modalInfo.value = { id: info.id ?? 'modal', title: info.title, message: info.message }
}
function closeModal() {
  modalInfo.value = null
}

function emitAction(comp: UniversalComponent, extra?: Record<string, unknown>) {
  const p = (comp.props ?? {}) as Record<string, unknown>
  const pActionObj = p.action && typeof p.action === 'object' ? p.action as Record<string, unknown> : undefined
  const compActionObj = comp.action as unknown as Record<string, unknown> | undefined
  const actionObj = pActionObj ?? compActionObj
  const behavior = (actionObj?.behavior as string | undefined) ?? (typeof p.action === 'string' ? p.action as string : undefined) ?? (p.behavior as string | undefined) ?? (compActionObj?.behavior as string | undefined) ?? (compActionObj?.action as string | undefined)
  const action = behavior
  const target = (actionObj?.target as string | undefined) ?? (p.target as string | undefined) ?? (compActionObj?.target as string | undefined)
  const ev: FajrinaActionEvent = {
    behavior: action,
    action,
    target,
    data: extra,
    params: (actionObj?.params as Record<string, unknown> | undefined) ?? (compActionObj?.params as Record<string, unknown> | undefined) ?? (p.params as Record<string, unknown> | undefined),
    sourceComponent: comp
  }
  emit('action', ev)
  if (action === 'externalLink') {
    const href = (actionObj?.href as string | undefined) ?? (compActionObj?.href as string | undefined) ?? (p.href as string | undefined) ?? (p.url as string | undefined)
    if (href) window.open(href, '_blank', 'noopener')
  }
  if (action === 'back') window.history.back()
  if (action === 'toast') {
    const msg = String(actionObj?.message ?? compActionObj?.message ?? p.message ?? p.content ?? 'Toast')
    showToast(msg)
  }
  if (action === 'openModal') {
    const modalId = String(actionObj?.modalId ?? compActionObj?.modalId ?? p.target ?? (p as Record<string,unknown>).target ?? comp.id)
    const title = String(actionObj?.title ?? p.title ?? '')
    const message = String(actionObj?.message ?? p.message ?? '')
    openModal({ id: modalId, title, message })
  }
  if (action === 'closeModal') closeModal()
  if (action === 'customEvent' && (actionObj?.eventName || compActionObj?.eventName || p.eventName)) {
    const name = String(actionObj?.eventName ?? compActionObj?.eventName ?? p.eventName ?? 'customEvent')
    document.dispatchEvent(new CustomEvent(name, { detail: (actionObj?.params ?? compActionObj?.params ?? p.params) as Record<string, unknown> }))
    showToast(`Event ${name} dispatched`)
  }
}

function layoutStyle(type: string, p: Record<string, unknown>, s: Record<string, string>): Record<string, string> {
  return buildLayoutStyle(type, p, s)
}

function handleFormSubmit(comp: UniversalComponent, e: Event) {
  const f = comp as UniversalComponent
  const children = (f.children ?? []) as UniversalComponent[]
  const hasChildren = children.length > 0
  const fd: Record<string, unknown> = {}
  let ok = true
  if (hasChildren) {
    const inputs = children.filter((ch) => ['Input', 'Select', 'Textarea'].includes(getComponentType(ch)))
    inputs.forEach((ch) => {
      const p = (ch.props ?? {}) as Record<string, unknown>
      const name = String(p.name ?? '')
      const el = (document.querySelector(`[data-fajrina-form='${f.id}'] [name='${name}']`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)
      if (el) fd[name] = el.value
      if (p.required && !String(fd[name] ?? '').trim()) {
        ok = false
        window.alert(`Field ${name} is required`)
      }
    })
  } else {
    const fields = ((f.props as Record<string, unknown>)?.fields as Array<Record<string, unknown>> | undefined) ?? []
    fields.forEach((fld) => {
      const el = (document.querySelector(`[data-fajrina-form='${f.id}'] [name='${String(fld.name)}']`) as HTMLInputElement | null)
      if (el) fd[String(fld.name)] = el.value
      if (fld.required && !String(fd[String(fld.name)] ?? '').trim()) {
        ok = false
        window.alert(`Field ${String(fld.name)} is required`)
      }
    })
  }
  if (ok) emitAction(f, fd)
}
</script>

<script lang="ts">
export default {
  name: 'Fajrina'
}
</script>

<template>
  <div v-if="!layout || !(layout.components && layout.components.length)" style="text-align:center;color:#94a3b8;font-size:14px;padding:40px 0">
    No components — pass Universal JSON as data
  </div>
  <template v-else>
    <template v-for="comp in (layout.components as UniversalComponent[])" :key="comp.id">
        <component
          v-if="getType(comp) === 'Heading'"
          :is="'h' + Math.min(6, Math.max(1, parseInt(String((comp.props as Record<string,unknown>)?.level ?? 2))))"
          :style="layoutStyle('Heading', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))"
        >
          {{ String((comp.props as Record<string,unknown>)?.content ?? (comp.props as Record<string,unknown>)?.text ?? '') }}
        </component>

        <p
          v-else-if="getType(comp) === 'Text'"
          :style="layoutStyle('Text', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))"
        >
          {{ String((comp.props as Record<string,unknown>)?.content ?? (comp.props as Record<string,unknown>)?.text ?? '') }}
        </p>

        <img
          v-else-if="getType(comp) === 'Image'"
          :src="String((comp.props as Record<string,unknown>)?.src ?? '')"
          :alt="String((comp.props as Record<string,unknown>)?.alt ?? '')"
          :style="{ maxHeight: '320px', ...layoutStyle('Image', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {})) }"
        />

        <button
          v-else-if="getType(comp) === 'Button'"
          :style="layoutStyle('Button', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))"
          :disabled="Boolean((comp.props as Record<string,unknown>)?.disabled)"
          @click="emitAction(comp)"
        >
          {{ String((comp.props as Record<string,unknown>)?.label ?? (comp.props as Record<string,unknown>)?.text ?? 'Button') }}
        </button>

        <!-- Generik: Container/Grid/Flex/Card/Hero/Space — hanya style + children -->
        <div
          v-else-if="['Container','Grid','Flex','Card','Hero','Space'].includes(getType(comp))"
          :style="layoutStyle(getType(comp), (comp.props as Record<string,unknown>||{}), (comp.style as Record<string,string>||{}))"
        >
          <Fajrina v-if="comp.children && comp.children.length" :data="{ layout: { components: comp.children as unknown as UniversalComponent[] } } as unknown as FajrinaData" @action="emit('action', $event)" />
        </div>

        <div v-else-if="getType(comp) === 'Divider'" :style="layoutStyle('Divider', (comp.props as Record<string,unknown>||{}), (comp.style as Record<string,string>||{}))">
          <template v-if="(comp.props as Record<string,unknown>)?.label">
            <div style="display:flex;align-items:center;gap:12px"><div style="flex:1;height:1px;background:#e2e8f0"></div><span style="font-size:12px;color:#94a3b8">{{ String((comp.props as Record<string,unknown>).label) }}</span><div style="flex:1;height:1px;background:#e2e8f0"></div></div>
          </template>
        </div>

        <div v-else-if="getType(comp) === 'Toast'" :style="layoutStyle('Toast', (comp.props as Record<string,unknown>||{}), (comp.style as Record<string,string>||{}))">
          {{ String((comp.props as Record<string,unknown>)?.message ?? (comp.props as Record<string,unknown>)?.content ?? '') }}
          <Fajrina v-if="comp.children && comp.children.length" :data="{ layout: { components: comp.children as unknown as UniversalComponent[] } } as unknown as FajrinaData" @action="emit('action', $event)" />
        </div>

        <div v-else-if="getType(comp) === 'Modal'" :style="layoutStyle('Modal', (comp.props as Record<string,unknown>||{}), (comp.style as Record<string,string>||{}))" @click="closeModal">
          <div style="background:#fff;border-radius:12px;max-width:520px;width:90%;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.2)" @click.stop>
            <h3 v-if="(comp.props as Record<string,unknown>)?.title" style="font-size:18px;font-weight:700;margin:0;color:#0f172a">{{ String((comp.props as Record<string,unknown>).title) }}</h3>
            <p v-if="(comp.props as Record<string,unknown>)?.message || (comp.props as Record<string,unknown>)?.content" style="font-size:14px;color:#475569;margin:8px 0 0 0">{{ String((comp.props as Record<string,unknown>)?.message ?? (comp.props as Record<string,unknown>)?.content ?? '') }}</p>
            <div v-if="comp.children && comp.children.length" style="margin-top:12px">
              <Fajrina :data="{ layout: { components: comp.children as unknown as UniversalComponent[] } } as unknown as FajrinaData" @action="emit('action', $event)" />
            </div>
            <div style="margin-top:12px;text-align:right"><button :style="layoutStyle('Button', {}, {})" @click="closeModal">Close</button></div>
          </div>
        </div>

        <form
          v-else-if="getType(comp) === 'Form'"
          :style="layoutStyle('Form', (comp.props as Record<string,unknown>||{}), (comp.style as Record<string,string>||{}))"
          @submit.prevent="(e: Event) => handleFormSubmit(comp, e)"
          :data-fajrina-form="comp.id"
        >
          <div style="display:flex;flex-direction:column;gap:12px">
            <template v-if="comp.children && (comp.children as UniversalComponent[]).length">
              <template v-for="child in (comp.children as UniversalComponent[])" :key="child.id">
                <div v-if="getType(child) === 'Input'">
                  <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String((child.props as Record<string,unknown>)?.label ?? (child.props as Record<string,unknown>)?.name) }}<span v-if="(child.props as Record<string,unknown>)?.required" style="color:#ef4444"> *</span></label>
                  <input :type="String((child.props as Record<string,unknown>)?.type ?? 'text')" :name="String((child.props as Record<string,unknown>)?.name)" :placeholder="String((child.props as Record<string,unknown>)?.placeholder ?? '')" :required="Boolean((child.props as Record<string,unknown>)?.required)" :style="layoutStyle('Input', (child.props as Record<string,unknown> || {}), (child.style as Record<string,string> || {}))" />
                </div>
                <div v-else-if="getType(child) === 'Select'">
                  <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String((child.props as Record<string,unknown>)?.label ?? (child.props as Record<string,unknown>)?.name) }}<span v-if="(child.props as Record<string,unknown>)?.required" style="color:#ef4444"> *</span></label>
                  <select :name="String((child.props as Record<string,unknown>)?.name)" :required="Boolean((child.props as Record<string,unknown>)?.required)" :style="layoutStyle('Select', (child.props as Record<string,unknown> || {}), (child.style as Record<string,string> || {}))">
                    <option value="">{{ String((child.props as Record<string,unknown>)?.placeholder ?? 'Select') }}</option>
                    <option v-for="opt in (((child.props as Record<string,unknown>)?.options as unknown[])||[])" :key="String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).value))" :value="String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).value))">{{ String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).label ?? (opt as Record<string,unknown>).value)) }}</option>
                  </select>
                </div>
                <div v-else-if="getType(child) === 'Textarea'">
                  <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String((child.props as Record<string,unknown>)?.label ?? (child.props as Record<string,unknown>)?.name) }}<span v-if="(child.props as Record<string,unknown>)?.required" style="color:#ef4444"> *</span></label>
                  <textarea :name="String((child.props as Record<string,unknown>)?.name)" :placeholder="String((child.props as Record<string,unknown>)?.placeholder ?? '')" :rows="Number((child.props as Record<string,unknown>)?.rows ?? 4)" :required="Boolean((child.props as Record<string,unknown>)?.required)" :style="layoutStyle('Textarea', (child.props as Record<string,unknown> || {}), (child.style as Record<string,string> || {}))"></textarea>
                </div>
                <button v-else-if="getType(child) === 'Button'" type="submit" :style="layoutStyle('Button', (child.props as Record<string,unknown> || {}), (child.style as Record<string,string> || {}))">{{ String((child.props as Record<string,unknown>)?.label ?? 'Submit') }}</button>
                <Fajrina v-else :data="{ layout: { components: [child] } } as unknown as FajrinaData" @action="emit('action', $event)" />
              </template>
            </template>
            <template v-else>
              <div v-for="field in (((comp.props as Record<string,unknown>)?.fields as Array<Record<string,unknown>>)||[])" :key="String(field.name)">
                <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String(field.label ?? field.name) }}</label>
                <select v-if="String(field.type)==='select'" :name="String(field.name)" :required="Boolean(field.required)" :style="layoutStyle('Select', field as Record<string,unknown>, {})">
                  <option value="">{{ String(field.placeholder ?? 'Select') }}</option>
                  <option v-for="opt in ((field.options as unknown[])||[])" :key="String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).value))" :value="String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).value))">{{ String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).label ?? (opt as Record<string,unknown>).value)) }}</option>
                </select>
                <input v-else :type="String(field.type ?? 'text')" :name="String(field.name)" :placeholder="String(field.placeholder ?? '')" :required="Boolean(field.required)" :style="layoutStyle('Input', field as Record<string,unknown>, {})" />
              </div>
              <button type="submit" :style="layoutStyle('Button', {}, (comp.style as Record<string,string> || {}))">{{ String((comp.props as Record<string,unknown>)?.submitLabel ?? 'Submit') }}</button>
            </template>
          </div>
        </form>

        <div v-else-if="getType(comp) === 'Input'" style="margin-bottom:8px">
          <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String((comp.props as Record<string,unknown>)?.label ?? (comp.props as Record<string,unknown>)?.name) }}<span v-if="(comp.props as Record<string,unknown>)?.required" style="color:#ef4444"> *</span></label>
          <input :type="String((comp.props as Record<string,unknown>)?.type ?? 'text')" :name="String((comp.props as Record<string,unknown>)?.name)" :placeholder="String((comp.props as Record<string,unknown>)?.placeholder ?? '')" :required="Boolean((comp.props as Record<string,unknown>)?.required)" :style="layoutStyle('Input', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))" />
        </div>
        <div v-else-if="getType(comp) === 'Select'" style="margin-bottom:8px">
          <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String((comp.props as Record<string,unknown>)?.label ?? (comp.props as Record<string,unknown>)?.name) }}<span v-if="(comp.props as Record<string,unknown>)?.required" style="color:#ef4444"> *</span></label>
          <select :name="String((comp.props as Record<string,unknown>)?.name)" :required="Boolean((comp.props as Record<string,unknown>)?.required)" :style="layoutStyle('Select', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))">
            <option value="">{{ String((comp.props as Record<string,unknown>)?.placeholder ?? 'Select') }}</option>
            <option v-for="opt in (((comp.props as Record<string,unknown>)?.options as unknown[])||[])" :key="String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).value))" :value="String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).value))">{{ String(typeof opt==='string'?opt:String((opt as Record<string,unknown>).label ?? (opt as Record<string,unknown>).value)) }}</option>
          </select>
        </div>
        <div v-else-if="getType(comp) === 'Textarea'" style="margin-bottom:8px">
          <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">{{ String((comp.props as Record<string,unknown>)?.label ?? (comp.props as Record<string,unknown>)?.name) }}<span v-if="(comp.props as Record<string,unknown>)?.required" style="color:#ef4444"> *</span></label>
          <textarea :name="String((comp.props as Record<string,unknown>)?.name)" :placeholder="String((comp.props as Record<string,unknown>)?.placeholder ?? '')" :rows="Number((comp.props as Record<string,unknown>)?.rows ?? 4)" :required="Boolean((comp.props as Record<string,unknown>)?.required)" :style="layoutStyle('Textarea', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))"></textarea>
        </div>

        <a
          v-else-if="getType(comp) === 'Link'"
          :href="String((comp.props as Record<string,unknown>)?.href ?? '#')"
          :target="String((comp.props as Record<string,unknown>)?.target ?? '_self')"
          :rel="String((comp.props as Record<string,unknown>)?.rel ?? 'noopener noreferrer')"
          :style="layoutStyle('Link', (comp.props as Record<string,unknown> || {}), (comp.style as Record<string,string> || {}))"
          @click.prevent="emitAction(comp)"
        >
          {{ String((comp.props as Record<string,unknown>)?.label ?? (comp.props as Record<string,unknown>)?.text ?? 'Link') }}
        </a>

        <div v-else style="padding:8px;border:1px solid #f59e0b;background:#fffbeb;font-size:12px;color:#92400e">Unsupported type: {{ getType(comp) }}</div>
      </template>
    <div v-if="toastMsg" :style="layoutStyle('Toast', {}, {})">{{ toastMsg }}</div>
    <div v-if="modalInfo" :style="layoutStyle('Modal', {}, {})" @click="closeModal">
      <div style="background:#fff;border-radius:12px;max-width:520px;width:90%;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.2)" @click.stop>
        <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">{{ modalInfo.title || 'Modal ' + modalInfo.id }}</h3>
        <p style="font-size:14px;color:#475569;margin:8px 0 0 0">{{ modalInfo.message || 'Ini modal overlay.' }}</p>
        <div style="margin-top:12px;text-align:right"><button :style="layoutStyle('Button', {}, {})" @click="closeModal">Close</button></div>
      </div>
    </div>
  </template>
</template>
