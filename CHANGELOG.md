# Changelog — @fajekrina/sdui

Semua perubahan penting paket ini dicatat di sini. Format mengikuti Keep a Changelog;
versi mengikuti Semantic Versioning (0.x: breaking change boleh di minor dengan catatan jelas).

## [0.6.0] — 2026-11-11

Menutup temuan review 0.5.0. Tes regresi: `tests/review-0.5.test.ts`.

### Diubah
- **#4 (BREAKING import)** `MESSAGES_ID` pindah ke entry baru **`@fajekrina/sdui/i18n`** (core hanya membawa
  `MESSAGES_EN`). Budget core dinaikkan **sadar** 18 → 20 KB (`scripts/size.mjs` mencatat alasannya); kenaikan
  berikutnya wajib dicatat di sini. Ukuran sekarang 18,1 KB.

### Diperbaiki
- **#1 Idempotency per pengiriman.** Satu kunci per *submission*: tap ulang setelah gagal/timeout dengan nilai form
  yang sama memakai kunci yang sama; nilai form berubah atau rantai sukses → kunci baru. Sumber id `crypto.randomUUID()`
  (bisa diganti lewat `createEngine({ newId })`); `Math.random` tidak dipakai lagi.
- **#2 Pembaruan SWR tidak mengganti layar di tengah interaksi.** Bila form kotor atau aksi berjalan, layout baru
  ditunda (`screen.hasPendingUpdate`, event `screen_update_deferred`) dan diterapkan saat idle atau lewat
  `screen.applyPendingUpdate()`; `screen.load` dijalankan ulang bila daftarnya berubah.
- **#3 Kunci tap ganda ditahan 1 dtk setelah `navigate`** (navigasi fire-and-forget), jadi tap kedua yang cepat
  tidak membuka layar dua kali.
- **#6** `HOST-BRIDGE.md`: checklist konfigurasi wajib sejak 0.5.0 (`PayloadSecurity.signed`, `MESSAGES_ID`,
  `assetURL` ke CDN, navigasi ganda, `Idempotency-Key` per pengiriman) dan contoh konfigurasi lengkap.

## [0.5.0] — 2026-11-11 · BREAKING (default keamanan)

Menutup temuan review 0.4.0 (1–10). Setiap temuan punya tes regresi di `tests/review-0.4.test.ts`.

### Diubah
- **#4 Default keamanan fail-closed.** `createEngine()` tanpa `security` kini **menolak semua payload** (release) dan
  menulis `logger.error`; dengan `debug: true` menerima payload tak bertanda tangan dengan peringatan keras. Untuk
  development tulis `PayloadSecurity.insecureDevelopment` secara eksplisit.
- **#7** `secure: true` tidak lagi memaksa keyboard numerik; jenis keyboard hanya dari `keyboard`
  (fixture `transfer_form`: PIN kini `keyboard: "number"`).

### Diperbaiki
- **#1 Layout basi tanpa manifest.** Bila cache aktif tetapi versi layar belum diketahui, layar dari cache disajikan
  *stale-while-revalidate*: tampil seketika, diambil ulang di belakang (`engine.settled()`), versi baru menggantikan
  layar yang sedang tampil lewat `onUpdate`, event `screen_revalidated`. Hit memori direvalidasi paling sering 30 dtk.
- **#2 Anti-rollback setelah restart.** Manifest yang diterapkan disimpan (tersegel cipher) di `CacheStore` dan
  diterapkan ulang (diverifikasi ulang) saat engine mulai; manifest lama setelah restart ditolak.
- **#3 Tap ganda.** `screen.handle` mengunci handler (dan form-nya) selama rantai aksi berjalan; tombol dirender
  `disabled` + `aria-busy`. Setiap tap membawa **idempotency key** (per request) → header `Idempotency-Key` untuk
  metode tulis di `fetchNetworkClient`.
- **#5 Path endpoint.** `{param}` kosong/hilang, `.`, atau `..` menggagalkan request sebelum dikirim.
- **#6 URL gambar.** `assetURL` bawaan (`relativeAssetURL`) menolak URL absolut, `//host`, `data:`, dan `..`;
  petakan nama ke CDN lewat `assetURL`.
- **#8** `auth.token` paralel di-dedupe (satu permintaan in-flight).
- **#9** Penerima iOS `window.sduiBridge` dibekukan dan tak bisa diganti; event host di-allow-list
  (`host.back`, `host.theme`, `host.viewport`); balasan harus cocok dengan id yang sedang ditunggu.
- **#10** Pesan validasi bisa dilokalkan: `createEngine({ messages })`; tersedia `MESSAGES_EN`, `MESSAGES_ID`.
- **#11** `DESAIN-ARSITEKTUR-SDUI.docx` dikeluarkan dari repo (`*.docx` di `.gitignore`).
- **Conformance Chromium ≡ WebKit (CI):** kontrol form kini punya metrik eksplisit (tinggi, line-height,
  `appearance: none`, panah `<select>` sendiri; tinggi `textArea` dari `rows`), karena ukuran bawaan
  select/textarea berbeda antar-engine. Harness memetakan aset ke PNG sungguhan (gambar 404 dirender beda per
  engine) dan menyamakan ejaan nilai terhitung yang setara (`flow-start` ≡ `flex-start`).

## [0.4.0] — 2026-11-11 · BREAKING

Eksekusi **"Usulan Arsitektur SDUI: Selaras dengan Murti"**: satu spec, satu engine, tiga host.
Format payload berganti total; data lama dikonversi (`fromUniversal`) atau dikeluarkan backend dalam format baru.

### Ditambahkan
- **Spec milik sendiri** di `spec/`: `sdui.schema.json` (Draft 2020-12, turunan murti v1 + v1.1 aditif),
  fixture `valid/` (murti + `transfer_form`, `home_load`) dan `invalid/` (murti + 6 baru), `spec/README.md`.
  Atribusi Apache-2.0 di `NOTICE`.
- **Engine berstruktur MurtiEngine** (`createEngine`): `componentFactory`, `screenFactory`, `actionDispatcher`,
  `validator`, `security`, `cache` di-inject; `load` / `screen(...)` / `prefetch` / `refreshManifest`; tidak pernah throw.
- `ScreenController`: load → `screen.load` paralel → render RenderNode → `handle` / `setFieldValue`; varian per lebar.
- **Model murti**: `SduiNode`, `SduiValue`, `ActionSpec`, `SduiPayload`/`SduiEnvelope` (base64 + `keyId`),
  `SduiBounds` (+ `maxLoadRequests` 8), `SchemaValidator`, `DataContext` + `{{token}}`, `resolveValue`.
- **Komponen** v1 (`text image vstack hstack zstack button card`) + v1.1 (`spacer divider grid scroll list form
  textField textArea picker`); style tertutup + **token warna semantik** (`--sdui-color-*`); simbol `systemName`.
- **Aksi** v1 (`navigate api dismiss refresh openURL`) + v1.1 (`toast`, `native`, `presentation` push/sheet/fullScreen);
  params mendukung token (token tunggal mempertahankan tipe).
- **Form**: scope `form.*`, validasi deklaratif, **pola bernama** (`numeric alphanumeric email phoneId amount pin6 nik`),
  `secure: true` (tidak pernah di-log/di-cache, tidak bocor ke data layar).
- **Cache** tiga tier (memori LRU → persisten → jaringan) per `screenKey@version`, verifikasi ulang tiap baca,
  last-good saat offline (hanya kegagalan transport), **manifest bertanda tangan dengan `sequence` anti-rollback**.
- **Port** (`NetworkClient`, `Navigator`, `HostPort`, `SignatureVerifier` + `keyedVerifier`, `CacheStore`, `CacheCipher`,
  `ViewportPort`, `Logger`). `./browser`: `fetchNetworkClient` (endpoint bernama di bundle, header async),
  `universalScreenProvider`, `webCryptoEd25519`, `indexedDbStore`, `aesGcmCipher`, `browserNavigator`, `windowViewport`.
- **`./bridge`**: protokol pesan web↔host (Android `addWebMessageListener`, iOS `WKScriptMessageHandler`),
  `nativeBridgePorts()` (navigasi, aksi `native`, token pola B, viewport, event analytics), `applyTheme`,
  `verifyBundleManifest` + `scripts/sign-bundle.mjs`.
- **Observabilitas** `onEvent`: `screen_loaded`, `validation_failed`, `unknown_component`, `action_dispatched`,
  `load_request`, `form_invalid`, `rollback_rejected`, `bridge_error`.
- **Renderer** generik `<SduiScreen>` (React, Vue) dan `mount()` (vanilla) + slot untuk komponen khusus toolkit.
- **Builder**: `EditorDocument` (pohon spec, undo/redo, impor legacy), **DSL TS** (`screen/vstack/text/button/navigate…`),
  `DSLExport` lossless, Studio DOM tunggal (React/Vue hanya wrapper) dengan panel JSON collapsible + sorot node.
- `./compat` `fromUniversal()`: konversi halaman Universal lama + peringatan per node (alat builder, bukan jalur runtime).
- Gerbang: tes spec (Ajv) + kemurnian core + paritas React = Vue = vanilla, `npm run size` (budget), `npm run conformance`
  (Chromium ≡ WebKit via Playwright), CI `.github/workflows/ci.yml` dengan `npm ci`.

### Dihapus (diganti)
- Format `UniversalPageConfig` / 18 tipe PascalCase / CSS bebas / `<Fajrina>` / `FajrinaBuilder` / `createRuntime` /
  `loadPage` / `toErrorPage`. Padanannya: spec v1.1 / komponen spec / style tertutup / `<SduiScreen>` / `SduiBuilder` /
  `createEngine` / `engine.load` / `errorView`.

### Perbaikan dari review 0.3.0
- ReDoS: regex dari payload diganti pola bernama. URL mentah di aksi `api`: diganti nama request (endpoint di bundle).
- Header statis: `getHeaders({ refresh })` async + satu kali refresh pada 401. Anti-rollback: `sequence` manifest.
- `customEvent` yang memunculkan toast: dihapus (aksi tertutup). Lockfile diperbarui; `npm ci` diverifikasi.

## [0.3.0] — 2026-11-10

Eksekusi `DESAIN-ARSITEKTUR-SDUI.md` Fase 0–3 (core memegang perilaku + RenderNode + adapter ketiga + builder).

### Ditambahkan
- **Runtime headless** `createRuntime()` — `load` / `render` / `handle` / `dispatch` / `submit` / state UI + `subscribe`.
- **Ports** (`core/ports`): storage, network, crypto, navigation, events, logger; default aman SSR/test (memori, no-op).
- Entry **`@fajekrina/sdui/browser`** (`browserPorts()`: localStorage, fetch + `If-None-Match`, WebCrypto, window/document).
- Entry **`@fajekrina/sdui/vanilla`** (`mount(el, options)`), adapter ketiga.
- **Builder — panel JSON** (React & Vue): tombol collapse ▾/▸ untuk buka/tutup panel; komponen yang dipilih di canvas
  disorot di JSON (pita biru + badge `Tipe · id · baris a–b`, auto-scroll). Helper headless `findComponentJsonRange(text, id)`.
- **RenderNode + registry** (`core/view-model`, `core/registry`): elemen, atribut tersanitasi, style final, binding field, wiring event diputuskan sekali di core.
- **Dispatcher aksi** (`core/actions`): `resolveAction` (normalisasi alias legacy), `onAction` → efek default yang bisa dibatalkan `event.preventDefault()`, cek policy sebelum efek, aksi `api` dengan rantai `onSuccess/onError` (≤ `maxChainDepth` 4).
- **UI store**: toast, modal, nilai + error form (validasi `required/minLength/maxLength/email/pattern`), error tampil di bawah field.
- **Loader** (`core/loader`): ETag/304, last-good cache, verifikasi envelope per `keyId` (termasuk isi cache), `verify.required` fail-closed.
- `mergePolicy`: policy aplikasi = batas atas, policy payload hanya mempersempit.
- Props React/Vue baru: `source`, `ports`, `verify`, `runtime`, `bounds`, `onLoad` / `@load`.
- `browserNetwork` default base `/api/universal/v1` (backend universal-service kini berversi); pesan error loader dibaca dari `errorMessage` (kontrak error backend baru), fallback `error`.
- Builder: pratinjau komponen memakai view-model core (== client), mode **Preview** penuh, panel validasi (validator yang sama dengan client/backend), palette dari registry core atau `registry` konsumen.
- Tes: gerbang kemurnian core, paritas React = Vue = vanilla (4 fixture termasuk 3 halaman `merchant_demo`), runtime, loader, adapter, builder (115 tes).

### Diubah
- Adapter React/Vue ditulis ulang jadi renderer generik (tanpa `switch` 18 tipe, tanpa `window`/`document`); `Fajrina.vue` → `Fajrina.ts` (render function).
- Vue membungkus output dengan satu `<div>` (sama dengan React).
- `<form>` diberi `novalidate`: validasi field kini dijalankan core, bukan browser.
- `navigate` tidak lagi diam saja secara implisit: tetap no-op default, tapi sekarang lewat `ports.navigation.navigate` (sambungkan router Anda).
- Link dengan href tidak aman (`javascript:` dll.) atau host di luar allow-list → `href="#"`; `position: fixed` di luar Modal/Toast dibuang.
- `validateData`: policy eksplisit + policy payload digabung (`mergePolicy`), cek behavior per tipe komponen, aksi `api`, kedalaman rantai.
- `SduiBounds.maxChainDepth` (opsional, default 4); `UniversalBehavior` + `back | submit | api`.
- **Pemetaan error lebih rinci** (kompatibel ke belakang kecuali kode di bawah):
  - `SduiError` + `status?` (HTTP) dan `serverCode?` (mis. `errorCode: "SDUI-002"` dari universal-service).
  - Kode baru `http` = server menjawab non-2xx; `network` kini **hanya** kegagalan transport (offline, CORS, abort, tanpa NetworkPort).
    **Perhatian:** 4xx/5xx tanpa cache dulu `network`, sekarang `http`.
  - `toErrorPage(message, { kind, code, status, serverCode })`: judul mengikuti jenis — `Not Found` (404/410), `Access Denied` (401/403),
    `Request Rejected` (4xx lain), `Service Unavailable` (5xx), `Offline`, `Invalid Page` (decode/signature), `Blocked` (strict).
    Detail mesin di `page.error`. Tanpa opsi = output lama (`Not Found`). Helper `errorKindOf(err)`.

### Deprecated (dihapus di 1.0)
- `loadPageWithCache`, `fetchUniversalPage*`, `fetchSignedPage` → `createRuntime().load` / `loadPage` + `NetworkPort`.
- Bentuk aksi legacy: `props.action` string, `props.behavior`, `url`/`action.action` (peringatan sekali per runtime).

### Diketahui
- Ukuran chunk core ~12,9 KB gzip, di atas target 10 KB pada desain §9 (belum ada gate `size-limit`).

## [0.2.0] — 2026-11-09

### Ditambahkan
- Validasi warn-first: modul `core/validate` (kode error `decode/schema/unsupportedVersion/unknownType/unknownAction/unlistedDomain/unlistedEvent/bounds/network`, 8 angka bounds, identifier ASCII longgar-ULID, `schemaVersion` 1.x, target aksi wajib, allow-list domain/event per merchant opsional). `warnValidation()` hanya `console.warn` — tidak mengubah render.
- Fajrina React/Vue: prop `mode` (`warn` default | `strict` fail-closed ke halaman error), `policy`, `theme`.
- Tema project: `core/theme` (`resolveTokenRef`, `applyThemeToStyle`, `resolveThemeTokens`, tipe `UniversalTheme`) + prop `theme` di kedua adapter. Token tak dikenal jatuh ke preset (fail-soft).
- Error page bersama `toErrorPage` di core; kedua demo memakainya (hapus duplikasi).
- Last-good cache `core/cache` (`loadPageWithCache`, key `fajrina-page:{mid}:{key}`); kedua demo memakainya saat fetch gagal.
- Tipe props per komponen (`core/props`, `ComponentPropsMap`, `PropsFor<T>`).
- Envelope bertanda tangan: tipe `SignedEnvelope`, `verifyEnvelope` (Ed25519 WebCrypto), `signBytes` + `encodeEnvelopeParts` untuk tooling/test. Backend: endpoint `?signed=true` + `/signing-key`, default nonaktif.
- Fixture `fixtures/valid/showcase-18.json` + 4 invalid; test suite vitest (core: tree/style/validate/theme/cache/sign; React: strict, Null-Object, no-alert, theme).

### Diubah
- Null-Object menggantikan kotak kuning "Unsupported type": tipe asing me-render nothing (marker garis putus-putus hanya di development).
- Validasi form gagal tidak lagi `alert()`: mengirim `validationError` via `onAction`/`@validationError`; demo mengabaikannya (tanpa panggilan server).
- Vue: hapus shim `declare module '@fajekrina/sdui*'` di `env.d.ts`; tipe library dipakai langsung. Alias tipe lokal di service/repository diganti tipe library.

### Backend yang disesuaikan (universal-service, repo terpisah)
- `schemaVersion: "1.0"` di semua halaman + model; format 1.x divalidasi saat save.
- Policy per merchant: file `data/universal/policies/{merchantId}.json`, endpoint GET/PUT `/api/universal/merchant/policies/{mid}`, dilampirkan otomatis di semua respons halaman.
- Save menegakkan: bounds (depth/nodes/string/props/children/array/identifier), Grid/Flex, navigate/modalId wajib, externalLink/customEvent melawan policy merchant bila ada.
- Aksi form checkout diperbaiki: string legacy `/api/payment` → `{behavior: "submit", params: {target: "home"}}`.
- Signing endpoint opsional (default nonaktif, butuh file kunci via konfigurasi).

## [0.1.0] — 2026-11-03
- Rilis awal: renderer agnostik React/Vue/Vanilla untuk Universal SDUI JSON (18 tipe), builder headless + UI React/Vue, tanpa Tailwind/Bootstrap, inline CSS via `buildLayoutStyle`.
- Tipe `UniversalComponentType` dilengkapi: Card, Flex, Grid, Hero, Space.
