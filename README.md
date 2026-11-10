# @fajekrina/sdui — Universal SDUI (framework-agnostic)

Renderer + runtime for **Universal SDUI** JSON (`GET /api/universal/client/page/{mid}/{key}`).
One headless core decides everything — validation, policy, style, actions, form state, toast/modal,
loading (ETag + last-good cache + Ed25519 verification). React, Vue and vanilla are thin adapters that
render the core's `RenderNode` tree, so the three produce identical DOM (enforced by a parity test).

No Tailwind/Bootstrap bundled, no class names emitted: all visuals are inline CSS (`buildLayoutStyle`).

## Install
```bash
npm install @fajekrina/sdui
# monorepo: workspace link (see root package.json)
```

## Entries

| Import | What |
|---|---|
| `@fajekrina/sdui` | core: `createRuntime`, `loadPage`, `validateData`, `buildLayoutStyle`, ports, registry, types |
| `@fajekrina/sdui/browser` | `browserPorts()` — localStorage, fetch (+ETag), WebCrypto, window/document |
| `@fajekrina/sdui/react` | `<Fajrina>`, `useSduiRuntime`, `SduiNode` |
| `@fajekrina/sdui/vue` | `<Fajrina>`, `useSduiRuntime`, `createSduiRuntime`, `SduiNodeView` |
| `@fajekrina/sdui/vanilla` | `mount(el, options)` |
| `@fajekrina/sdui/builder`, `/builder/react`, `/builder/vue` | headless builder state + `FajrinaBuilder` UIs |

## Usage

### React
```tsx
import { Fajrina } from '@fajekrina/sdui/react'
import { useNavigate } from 'react-router-dom'

function Page({ data }) {
  const navigate = useNavigate()
  return (
    <Fajrina
      data={data}                                  // or source={{ merchantId, pageKey }}
      ports={{ navigation: { navigate: (t) => navigate(`/merchant_demo/${t}`), back: () => navigate(-1), openExternal: (h) => window.open(h, '_blank', 'noopener') } }}
      policy={{ allowedDomains: ['example.com'] }} // app policy = upper bound
      mode="warn"                                  // or "strict" (fail closed)
      onAction={(e) => { if (e.behavior === 'submit') api.submit(e.data) }}
    />
  )
}
```

### Vue
```vue
<script setup>
import Fajrina from '@fajekrina/sdui/vue'
</script>
<template>
  <Fajrina :source="{ merchantId: 'merchant_demo', pageKey: 'home' }" :ports="ports" @action="onAction" />
</template>
```

### Vanilla
```ts
import { mount } from '@fajekrina/sdui/vanilla'
const view = mount(document.getElementById('app')!, { source: { merchantId: 'merchant_demo', pageKey: 'home' } })
```

### Core only (SSR, tests, other frameworks)
```ts
import { createRuntime } from '@fajekrina/sdui'
const rt = createRuntime({ mode: 'strict' })
const { nodes, errors } = rt.render(page)   // pure RenderNode tree, no DOM
```

## Actions
`props.action.behavior` ∈ `navigate | back | submit | externalLink | openModal | closeModal | toast | customEvent | api`.
`onAction` fires first; call `event.preventDefault()` to skip the default effect. Defaults go through ports:
navigation (`navigate` is a no-op until you wire your router), `events.emit` for `customEvent`, the UI store for
toast/modal. `externalLink`, `api` and `customEvent` are checked against the effective policy before anything
happens (blocked → `onAction({ behavior: 'blocked' })`). Forms are validated by the core (`required`, `minLength`,
`maxLength`, `validation: [{ rule: 'email' }]`) and field errors are rendered under the field.

Legacy shapes (`props.action: "back"`, `props.behavior`, `url`) still work with a one-time deprecation warning; removed in 1.0.

## Styling
Precedence per property: **inline `style` > token (theme) > preset**. Presets per type live in `buildLayoutStyle`;
`theme={{ tokens: { brand: { primary: '#6c8cff' } } }}` resolves `token: { backgroundColor: 'brand.primary' }`.
`position: fixed` is only honoured on Modal/Toast.

## Dev
```bash
npm run build       # vite lib → dist/{core,browser,react,vue,vanilla,builder}
npm run typecheck
npm test            # core purity gate, React=Vue=vanilla parity, runtime, loader, adapters
```

Design: `DESAIN-FRAMEWORK-SDUI.md` (framework), `DESAIN-SISTEM-SDUI.md` (backend storage). Handoff: `HANDOFF.md`.
