# @fajekrina/sdui

Server-driven UI for the web, Android WebView and iOS WKWebView — **one spec, one
engine, three hosts.** The server describes *what* a screen is (a JSON node tree +
data + actions); this package owns *how* it renders, navigates, and talks to the
network.

- **Spec** — [`spec/sdui.schema.json`](spec/sdui.schema.json): our own contract,
  derived from [murti](https://github.com/iQbalADR/murti) v1 with additive v1.1
  features (forms, `screen.load`, toast/native actions, layout components, theme
  tokens, width variants). Guide: [`spec/README.md`](spec/README.md).
- **Engine** — headless TypeScript with the MurtiEngine structure: injected
  component/screen factories, action dispatcher, validator, security and cache.
  No DOM, no framework; every side effect through ports.
- **Renderers** — React, Vue and vanilla render the engine's `RenderNode` tree
  generically (identical DOM, enforced by a parity test).
- **Hosts** — browser (`./browser`) or a native app via the bridge (`./bridge`).

## Install

```bash
npm install @fajekrina/sdui
```

| Import | What |
| --- | --- |
| `@fajekrina/sdui` | engine: `createEngine`, `ScreenSource`, `ComponentFactory`, `ScreenFactory`, `ActionDispatcher`, `PayloadSecurity`, `SduiCache`, model, ports |
| `@fajekrina/sdui/browser` | `fetchNetworkClient`, `universalScreenProvider`, `webCryptoEd25519`, `indexedDbStore`, `aesGcmCipher`, `browserNavigator`, `windowViewport`, `browserPorts` |
| `@fajekrina/sdui/bridge` | `nativeBridgePorts`, `detectHost`, `applyTheme`, `verifyBundleManifest` — see [HOST-BRIDGE.md](HOST-BRIDGE.md) |
| `@fajekrina/sdui/react` · `/vue` | `<SduiScreen engine source />` |
| `@fajekrina/sdui/vanilla` | `mount(el, { engine, source })` |
| `@fajekrina/sdui/builder` · `/builder/react` · `/builder/vue` | `EditorDocument`, DSL, `DSLExport`, `mountStudio` / `<SduiBuilder />` |
| `@fajekrina/sdui/compat` | `fromUniversal()` — import legacy Universal pages in the builder |
| `@fajekrina/sdui/spec/sdui.schema.json` | the schema (backend validation, CI) |

## Quickstart (browser)

```ts
import { ActionDispatcher, MESSAGES_ID, PayloadSecurity, ScreenFactory, SduiCache, createEngine } from '@fajekrina/sdui'
import { browserNavigator, fetchNetworkClient, indexedDbStore, universalScreenProvider, webCryptoEd25519, windowViewport } from '@fajekrina/sdui/browser'

const engine = createEngine({
  screenFactory: new ScreenFactory().registerFallback(
    universalScreenProvider({ baseUrl: '/api/universal/v1', merchantId: 'merchant_demo' })),
  actionDispatcher: new ActionDispatcher({
    // payloads only NAME requests; method + path live here (the allow-list)
    network: fetchNetworkClient({
      baseUrl: '/api', endpoints: { getBalance: { method: 'GET', path: '/accounts/balance' } },
      getHeaders: async () => ({ Authorization: `Bearer ${await session.token()}` })
    }),
    navigator: browserNavigator({ navigate: (screen, params) => router.push({ name: screen, query: params }), links: { helpCenter: 'https://help.example.com' } })
  }),
  security: PayloadSecurity.signed(await webCryptoEd25519(EMBEDDED_PUBLIC_KEY)),   // required: none = reject all
  assetURL: (name) => `https://cdn.example.com/sdui/${name}.webp`,
  messages: MESSAGES_ID,
  cache: new SduiCache({ store: indexedDbStore() }),
  viewport: windowViewport()
})
```

```tsx
// React
import { SduiScreen } from '@fajekrina/sdui/react'
<SduiScreen engine={engine} source={{ key: 'home' }} seed={{ user }} />
```

```vue
<!-- Vue -->
<SduiScreen :engine="engine" :source="{ key: 'home' }" :seed="{ user }" />
```

```ts
// vanilla
import { mount } from '@fajekrina/sdui/vanilla'
mount(document.getElementById('app')!, { engine, source: { key: 'home' } })
```

## Inside an Android / iOS WebView

```ts
import { nativeBridgePorts } from '@fajekrina/sdui/bridge'

const host = nativeBridgePorts()   // Android addWebMessageListener / iOS WKScriptMessageHandler
const engine = createEngine({
  actionDispatcher: new ActionDispatcher({
    navigator: host.navigator, host: host.host,
    network: fetchNetworkClient({ baseUrl, endpoints, getHeaders: host.getHeaders })   // token pattern B
  }),
  viewport: host.viewport,
  onEvent: host.onEvent
})
```

The host protocol, security rules and bundle distribution are in [HOST-BRIDGE.md](HOST-BRIDGE.md).

## Authoring

```ts
import { screen, vstack, text, button, navigate } from '@fajekrina/sdui/builder'

const json = screen('home', vstack({ spacing: 12 }, [
  text('Halo, {{user.name}}', { style: 'title' }),
  button('Detail', navigate('productDetail', { presentation: 'sheet' }))
])).validated().toJSON()
```

Or visually: `<SduiBuilder onSave={…} onPublish={…} />` (React/Vue) — the canvas
uses the client's own components, export validates, and **Export DSL** turns any
screen back into code.

## Extending

```ts
class RatingComponent implements Component {
  static readonly type = 'rating'
  makeView(node: SduiNode, ctx: RenderContext) {
    return renderNode(ctx.keyFor(node), 'span', { text: '★'.repeat(node.int('stars')) })
  }
}
engine.componentFactory.register(new RatingComponent())
```

Toolkit-specific widgets (a React chart, a map) go through slots:
`<SduiScreen slots={{ chart: (slot) => <Chart data={slot.props.series} /> }} />`.

## Security model

Without `security`, a release engine **rejects every payload** (fail-closed); development
says `PayloadSecurity.insecureDevelopment` out loud. Without a manifest, cached screens are
served stale-while-revalidate; the applied manifest (and its anti-rollback `sequence`) is
persisted across restarts. Each tap is locked while its action runs and carries an
`Idempotency-Key`. Image names resolve to relative paths only unless you map them.


Closed action vocabulary with **named** targets (never a raw URL); bounded validation
(depth 32, nodes 5000, strings 4096, chain 4, load 8); Ed25519 envelopes verified on
every load including from cache (`keyId` for rotation); signed manifest with a
monotonic `sequence` (anti-rollback); named field patterns (no regex from payloads);
`secure` fields never logged or cached; no `innerHTML` anywhere.

## Develop

```bash
npm ci
npm run typecheck
npm test             # unit + spec gate (Ajv) + core purity + React=Vue=vanilla parity
npm run build
npm run size         # bundle budget
npm run conformance  # Chromium ≡ WebKit (npx playwright install chromium webkit once)
```

See [CHANGELOG.md](CHANGELOG.md) and [HANDOFF.md](HANDOFF.md). Licensed MIT; the spec
and murti-derived parts are Apache-2.0 — see [NOTICE](NOTICE).
