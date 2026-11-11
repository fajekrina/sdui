// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Bridge, applyTheme, detectHost, nativeBridgePorts, verifyBundleManifest, type BridgeTransport } from '../src/bridge'
import { webCryptoEd25519 } from '../src/browser'
import { ActionDispatcher, ActionSpec, ScreenSource, SduiError, createEngine, hex, sortedJSONStringify, utf8 } from '../src/core'
import { envelopeJSON, flush, signingKey , devEngine } from './helpers'

/// A fake native host: records requests and answers by method.
function fakeHost(answer: (method: string, params: Record<string, unknown>) => unknown | Error) {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = []
  let deliver: (m: string) => void = () => {}
  const transport: BridgeTransport = {
    post(raw) {
      const msg = JSON.parse(raw)
      sent.push({ method: msg.method, params: msg.params ?? {} })
      const result = answer(msg.method, msg.params ?? {})
      queueMicrotask(() => deliver(JSON.stringify(result instanceof Error ? { v: 1, id: msg.id, ok: false, error: result.message } : { v: 1, id: msg.id, ok: true, result })))
    },
    listen(on) { deliver = on }
  }
  return { transport, sent, event: (event: string, data?: Record<string, unknown>) => deliver(JSON.stringify({ v: 1, event, data })) }
}

describe('native bridge', () => {
  it('detects the host', () => {
    expect(detectHost({} as Window)).toBe('browser')
    expect(detectHost({ sduiHost: { postMessage() {}, onmessage: null } } as unknown as Window)).toBe('android')
    expect(detectHost({ webkit: { messageHandlers: { sdui: { postMessage() {} } } } } as unknown as Window)).toBe('ios')
  })

  it('correlates replies, rejects host errors, times out', async () => {
    const host = fakeHost((method) => (method === 'host.info' ? { platform: 'android' } : new Error('denied')))
    const bridge = new Bridge(host.transport, 50)
    expect(await bridge.call('host.info')).toEqual({ platform: 'android' })
    await expect(bridge.call('native.command', { command: 'x' })).rejects.toThrow('denied')
    const silent = new Bridge({ post() {}, listen() {} }, 20)
    await expect(silent.call('host.info')).rejects.toThrow('timed out')
  })

  it('ports: navigator notifies, native returns results, unsupported → unknownCommand', async () => {
    const host = fakeHost((method, params) => {
      if (method === 'native.command') return params.command === 'biometricConfirm' ? { confirmed: true } : new Error('unsupported')
      return null
    })
    const ports = nativeBridgePorts({ transport: host.transport })
    ports.navigator.navigate('transferForm', { id: 1 }, { presentation: 'sheet' })
    ports.navigator.openLink('helpCenter')
    expect(await ports.host.native('biometricConfirm', {})).toEqual({ confirmed: true })
    await expect(ports.host.native('camera', {})).rejects.toSatisfy((e: unknown) => e instanceof SduiError && e.kind === 'unknownCommand')
    expect(host.sent.slice(0, 2)).toEqual([
      { method: 'navigator.navigate', params: { screen: 'transferForm', params: { id: 1 }, presentation: 'sheet' } },
      { method: 'navigator.openLink', params: { name: 'helpCenter' } }
    ])
  })

  it('token pattern B: fetched once, kept in memory, refreshed on demand', async () => {
    let n = 0
    const host = fakeHost((method) => (method === 'auth.token' ? { accessToken: `t${++n}` } : null))
    const ports = nativeBridgePorts({ transport: host.transport })
    expect(await ports.getHeaders({ refresh: false })).toEqual({ Authorization: 'Bearer t1' })
    expect(await ports.getHeaders({ refresh: false })).toEqual({ Authorization: 'Bearer t1' })
    expect(await ports.getHeaders({ refresh: true })).toEqual({ Authorization: 'Bearer t2' })
    expect(host.sent.filter((s) => s.method === 'auth.token')).toHaveLength(2)
  })

  it('host events: back → dismiss via the screen; viewport updates', async () => {
    const host = fakeHost(() => null)
    const ports = nativeBridgePorts({ transport: host.transport })
    const engine = devEngine({ actionDispatcher: new ActionDispatcher({ navigator: ports.navigator, host: ports.host }), viewport: ports.viewport })
    const screen = engine.screen(ScreenSource.inline('{"schemaVersion":"1.1","screen":{"key":"s","root":{"type":"text"}}}'))
    await screen.load()
    ports.onHostEvent('host.back', () => { void screen.dispatch(new ActionSpec({ type: 'dismiss' })) })
    host.event('host.back')
    host.event('host.viewport', { width: 900 })
    await flush()
    expect(host.sent.some((s) => s.method === 'navigator.dismiss')).toBe(true)
    expect(ports.viewport.width()).toBe(900)
  })

  it('applies a host theme as CSS variables (hex only)', () => {
    applyTheme({ primary: '#112233', evil: 'red; background:url(x)' })
    expect(document.documentElement.style.getPropertyValue('--sdui-color-primary')).toBe('#112233')
    expect(document.documentElement.style.getPropertyValue('--sdui-color-evil')).toBe('')
  })

  it('bundle manifest: verifies signature, hashes, rollback, bridge version', async () => {
    const key = await signingKey()
    const verifier = await webCryptoEd25519(key.publicKey)
    const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(d)))
    const files = { 'index.html': utf8('<html></html>'), 'app.js': utf8('console.log(1)') }
    const manifest = async (seq: number, minBridge = 1, tamper = false) => {
      const hashes: Record<string, string> = {}
      for (const [p, b] of Object.entries(files)) hashes[p] = hex(await sha256(b))
      if (tamper) hashes['app.js'] = '00'
      const body = utf8(sortedJSONStringify({ version: `1.0.${seq}`, sequence: seq, files: hashes, minBridge, minHost: '1.0.0' }))
      return envelopeJSON(body, await key.sign(body))
    }
    const ok = await verifyBundleManifest({ envelope: await manifest(3), files, verifier, lastSequence: 2, bridgeVersion: 1, sha256 })
    expect(ok.sequence).toBe(3)
    await expect(verifyBundleManifest({ envelope: await manifest(1), files, verifier, lastSequence: 2, bridgeVersion: 1, sha256 })).rejects.toMatchObject({ kind: 'rollback' })
    await expect(verifyBundleManifest({ envelope: await manifest(3, 1, true), files, verifier, bridgeVersion: 1, sha256 })).rejects.toMatchObject({ kind: 'signatureInvalid' })
    await expect(verifyBundleManifest({ envelope: await manifest(3, 2), files, verifier, bridgeVersion: 1, sha256 })).rejects.toMatchObject({ kind: 'unsupportedVersion' })
  })

  it('events are forwarded to native analytics', async () => {
    const host = fakeHost(() => null)
    const ports = nativeBridgePorts({ transport: host.transport })
    const spy = vi.fn()
    ports.onEvent({ type: 'screen_loaded', key: 'home', origin: 'network', ms: 12 })
    spy()
    expect(host.sent.at(-1)).toEqual({ method: 'events.track', params: { event: { type: 'screen_loaded', key: 'home', origin: 'network', ms: 12 } } })
  })
})
