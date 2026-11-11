# Host bridge — Android WebView & iOS WKWebView

The Android and iOS apps are **hosts**: they load the same `@fajekrina/sdui` web
bundle in a WebView and answer a small, closed set of named messages. They never
render SDUI components themselves. This document is the contract for the host
teams; the web side is `src/bridge/` (`nativeBridgePorts`).

## Transport

| | Android | iOS |
| --- | --- | --- |
| Register | `WebViewCompat.addWebMessageListener(webView, "sduiHost", setOf(BUNDLE_ORIGIN), listener)` | `contentController.add(handler, name: "sdui")` |
| Web → host | `window.sduiHost.postMessage(json)` | `window.webkit.messageHandlers.sdui.postMessage(json)` |
| Host → web | `replyProxy.postMessage(json)` (arrives on `window.sduiHost.onmessage`) | `webView.evaluateJavaScript("window.sduiBridge.receive(\(jsonLiteral))")` |
| Accept only | messages whose `sourceOrigin` is the bundle origin | messages from frames on the bundle origin (`message.frameInfo.securityOrigin`) |

Never `addJavascriptInterface`, never `evaluateJavaScript` with payload-derived
strings other than the JSON reply, never file URLs (`setAllowFileAccess(false)`).

## Messages

```jsonc
// web → host (request)                       // host → web (reply, same id)
{ "v": 1, "id": "r-42", "method": "…", "params": {} }   { "v": 1, "id": "r-42", "ok": true, "result": … }
                                                        { "v": 1, "id": "r-42", "ok": false, "error": "…" }
// host → web (event, no id)
{ "v": 1, "event": "host.back" }
```

| `method` | `params` | Host does | Reply `result` |
| --- | --- | --- | --- |
| `host.info` | — | | `{ platform, bridgeVersion, appVersion }` |
| `navigator.navigate` | `{ screen, params, presentation: push·sheet·fullScreen }` | open the next SDUI screen (or a native screen mapped by name) | `null` |
| `navigator.dismiss` | — | close the WebView / pop | `null` |
| `navigator.refresh` | — | optional chrome refresh | `null` |
| `navigator.openLink` | `{ name }` | map the **name** through the app's allow-list → Custom Tabs / SFSafariViewController; unknown names are ignored | `null` |
| `auth.token` | `{ refresh: boolean }` | return a **short-lived** access token (minutes, SDUI-API audience) from Keystore/Keychain-held refresh credentials; `refresh: true` after a 401 | `{ accessToken }` |
| `native.command` | `{ command, params }` | run an **allow-listed** command (`biometricConfirm`, `share`, …); anything else → error | command result (merged into the screen data under the command name) |
| `events.track` | `{ event }` | forward to native analytics (no PII inside) | `null` |

| `event` | `data` | Web does |
| --- | --- | --- |
| `host.back` | — | the app dispatches `{ type: "dismiss" }` on the current screen |
| `host.theme` | `{ colors: { primary: "#0A66C2", … } }` | `applyTheme()` → `--sdui-color-*` |
| `host.viewport` | `{ width }` | re-picks `screen.variants` |

Replies must arrive within 15 s or the call fails (and the payload's `onError` runs).

## Security rules for hosts

1. **Token pattern B.** The web side never holds a long-lived credential: it asks
   `auth.token` and keeps the access token in memory only. Use a narrow audience and
   a lifetime of a few minutes; optionally DPoP-bind it.
2. **Endpoints live in the bundle**, not in payloads; CSP `connect-src` lists only
   the API domain. Suggested CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src https://api.example.com`.
   (`style-src 'unsafe-inline'` is needed because renderers write inline style
   attributes; scripts stay strictly `'self'`.)
3. **Sensitive actions** (transfer, PIN change, new payee) are authorized server-side
   with proof from a `native` command (biometric/PIN) plus app attestation
   (Play Integrity / App Attest).
4. **Certificate pinning** does not apply to WebView traffic; an endpoint that must be
   pinned is called through a `native` command.
5. Responses marked `Cache-Control: no-store`; the engine never caches `api` results.
6. **Idempotency.** Every user tap carries an `Idempotency-Key` header on write requests
   (`<tap>:<request>`); the backend must reject duplicates (double taps, retries).
7. **Host events are allow-listed** on the web side (`host.back`, `host.theme`,
   `host.viewport`) and replies must match a pending request id. A script running on the
   bundle origin could still post an allow-listed event — the strict CSP above (no
   third-party or inline scripts) is what keeps such scripts out.

### Host checklist

- [ ] The engine is created with `PayloadSecurity.signed(...)` (without it, release builds reject every payload).
- [ ] The payload public key(s) and the bundle public key are embedded; they are different keys.
- [ ] The highest applied bundle `sequence` is **persisted** (Keystore/Keychain-backed storage) and checked at
      start; an older bundle is rejected even after a reinstall-free restart.
- [ ] `auth.token` returns minutes-long tokens with a narrow audience.
- [ ] Only the fixed local origin may use the bridge; file access off.
- [ ] `native.command` only runs allow-listed commands.

## Bundle distribution (downloaded and cached)

1. CI builds the bundle and runs
   `node scripts/sign-bundle.mjs <dir> --version X --sequence N --key bundle-key.pem --key-id bundle-2026`
   → `bundle-manifest.json`: an envelope over `{ version, sequence, files: { path: sha256 }, minBridge, minHost }`,
   signed with the **bundle key** (not the payload key).
2. The host downloads the manifest and files, verifies the signature with the public
   key embedded in the app, every file hash, `sequence ≥ last` (anti-rollback — `last`
   is persisted across restarts),
   `minBridge ≤ host bridge`, and only then stores them. On failure it keeps the
   last-good bundle; with none, the minimal bundle shipped inside the app.
   `verifyBundleManifest()` (`src/bridge/bundle-manifest.ts`) is the reference
   implementation of these steps.
3. Serve from a **fixed local origin**: Android `WebViewAssetLoader`
   (`https://appassets.androidplatform.net`), iOS `WKURLSchemeHandler` (custom
   scheme). Only that origin may talk to the bridge.
4. Staging/production channels, gradual rollout, and a kill switch (a manifest with a
   higher `sequence` pointing back to a safe version).

## Minimum engine versions

Ed25519 in WebCrypto is available from Chromium 137 and Safari/WebKit 17. Below
that, pass a JS verifier (e.g. `@noble/ed25519`) as the `SignatureVerifier`. Set
the official minimum Android System WebView and iOS versions from current
distribution data (open item from the proposal); CI conformance runs Chromium and
WebKit on every PR.

## Web side, in one call

```ts
const host = nativeBridgePorts()
host.onHostEvent('host.back', () => screen.dispatch(new ActionSpec({ type: 'dismiss' })))
host.onHostEvent('host.theme', (data) => applyTheme(data.colors as Record<string, string>))
const engine = createEngine({
  actionDispatcher: new ActionDispatcher({ navigator: host.navigator, host: host.host,
    network: fetchNetworkClient({ baseUrl, endpoints, getHeaders: host.getHeaders }) }),
  viewport: host.viewport, onEvent: host.onEvent
})
```
