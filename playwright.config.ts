import { defineConfig } from '@playwright/test'

// Conformance: Chromium (Android System WebView) vs WebKit (iOS WKWebView), and vs
// Firefox for the web (CONFORMANCE_PAIR); csp.spec.ts: strict CSP + Trusted Types.
// `npm run conformance` (needs `npx playwright install chromium webkit firefox` once).
export default defineConfig({
  testDir: 'conformance',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5179' },
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179/conformance/index.html',
    reuseExistingServer: true,
    timeout: 60_000
  }
})
