// Renders one spec fixture with the vanilla renderer — the same bundle a
// WebView host loads — so the conformance test can compare engines.
import { PayloadSecurity, createEngine } from '../src/core'
import { mount } from '../src/vanilla'

const name = new URLSearchParams(location.search).get('fixture') ?? 'dashboard.json'
const seed = { user: { name: 'Ada', segment: 'gold' }, getBalance: { amount: 1250 }, getPromos: { items: [{ title: 'Cashback' }, { title: 'Points' }] } }
const response = await fetch(`/spec/fixtures/valid/${name}`)
const payload = await response.json()
const view = mount(document.getElementById('app')!, { engine: createEngine({ security: PayloadSecurity.insecureDevelopment }), source: { payload }, seed })
await view.screen.load()
// settle images (loaded or failed) so layout is final before the snapshot
await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })))
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
;(window as unknown as { __sduiReady: boolean }).__sduiReady = true
