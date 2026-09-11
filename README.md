# fajrina-sdui — Universal SDUI (agnostic)

`fajrina-sdui` is an agnostic renderer for **Universal SDUI** JSON (`GET /api/universal/client/page/{mid}/{key}` `UniversalPageConfig.java:22`). **True agnostic (v0.2.0)** — no Tailwind/Bootstrap bundled, no `className` emitted. All visuals are inline CSS via `buildLayoutStyle` (`TOKENS` `xs|sm|md|lg|xl|2xl`) + `comp.style` from JSON. Consumer injects own CSS via `style` prop or wrapper `className` if desired.

## Install
```bash
npm install fajrina-sdui
# or local monorepo
npm install file:./packages/fajrina-sdui
```

## Usage

### Vanilla (core)
```ts
import { FajrinaData, normalizeToLayout, buildLayoutStyle } from 'fajrina-sdui'
```

### React
```tsx
import { Fajrina } from 'fajrina-sdui/react'
import { fetchUniversalPage } from 'fajrina-sdui'

function App() {
  const [data, setData] = useState(null)
  useEffect(() => { fetch('/api/universal/client/page/merchant_demo/home').then(r=>r.json()).then(setData) }, [])
  return <Fajrina data={data} onAction={(e)=> console.log(e)} />
}
```

### Vue
```vue
<script setup>
import Fajrina from 'fajrina-sdui/vue'
// no Bootstrap import needed — agnostic inline style only
const data = ref(null)
onMounted(async()=> data.value = await fetch('/api/universal/client/page/merchant_demo/home').then(r=>r.json()))
</script>
<template><Fajrina :data="data" @action="console.log" /></template>
```

### Data shape (Universal)
- `UniversalPageConfig` `{ pageId, pageKey, merchantId, status, layout:{ title, subtitle, components[] } }` `UniversalPageConfig.java:22`
- `layout` `{ components[] }`
- `components[]` array
- each component `{ type, id, props, style, children, action }` — 16 types `Button|Card|Container|Flex|Grid|Heading|Image|Text|Form|Input|Select|Textarea|Link|Divider|Hero|Space` `UniversalPageConfigService.java:151` + `components.json:6`

`data` prop accepts any of above — `normalizeToLayout()` handles it.

## Actions
`props.action` / `action.behavior` = `navigate|submit|openModal|closeModal|externalLink|back|toast|customEvent` `components.json:104`. Emitted via `onAction` / `@action`. Default browser behaviors handled (externalLink -> window.open, back -> history.back, toast -> lightweight div).

## Styling
`buildLayoutStyle(type, props, style)` — **true agnostic, netral** (`style.ts:32`): `Button` netral `#fff`/`#e2e8f0` (variant diabaikan, warna hanya dari `style` JSON), `Card/Hero/Form` border `#e2e8f0` radius `12px`, `Input/Select/Textarea` border `#cbd5e1` `100% width`, `Flex/Grid/Space/Container` seperti sebelumnya, plus `Heading/Text/Image/Link/Divider` minimal defaults. Inline `style` dari JSON selalu menang. No Tailwind/Bootstrap classes emitted — consumer adds its own CSS via `comp.style` or wrapper `className`/`style` props.

## Dev
```bash
cd packages/fajrina-sdui
npm install
npm run build   # vite lib -> dist/{core,react,vue}.{js,cjs,d.ts}
npm run typecheck
```
