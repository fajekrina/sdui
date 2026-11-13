// Every valid fixture rendered by the vanilla renderer, plus the Studio, under the strict
// CSP of csp.html. Violations are collected for conformance/csp.spec.ts.
import { PayloadSecurity, createEngine } from '../src/core'
import { mount } from '../src/vanilla'
import { EditorDocument, mountStudio } from '../src/builder'

const violations: string[] = []
document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`))

const names = (new URLSearchParams(location.search).get('fixtures') ?? 'dashboard.json').split(',')
const seed = { user: { name: 'Ada', segment: 'gold' }, getBalance: { amount: 1250 }, getPromos: { items: [{ title: 'Cashback' }] } }
const engine = createEngine({ security: PayloadSecurity.insecureDevelopment, assetURL: () => '/conformance/asset.png' })

for (const name of names) {
  const payload = await (await fetch(`/spec/fixtures/valid/${name}`)).json()
  const host = document.createElement('div')
  document.getElementById('app')!.append(host)
  await mount(host, { engine, source: { payload }, seed }).screen.load()
}

const doc = new EditorDocument()
doc.importJSON(await (await fetch(`/spec/fixtures/valid/${names[0]}`)).json())
mountStudio(document.getElementById('studio')!, { document: doc })

await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
;(window as unknown as { __csp: { ready: boolean; violations: string[]; studioStyled: boolean } }).__csp = {
  ready: true,
  violations,
  // the constructable stylesheet really applied (not silently blocked)
  studioStyled: getComputedStyle(document.querySelector('.sdui-studio')!).display === 'flex'
}
