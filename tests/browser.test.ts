import { describe, expect, it, vi } from 'vitest'
import { fetchNetworkClient, universalScreenProvider } from '../src/browser'
import { NamedRequest, SduiError, utf8String } from '../src/core'

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('fetchNetworkClient', () => {
  const endpoints = {
    getBalance: { method: 'GET' as const, path: '/accounts/{accountId}/balance' },
    createTransfer: { method: 'POST' as const, path: '/transfers' }
  }

  it('maps a request NAME to the bundle endpoint: path params, query, JSON body', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response(200, { ok: true }))
    const client = fetchNetworkClient({ baseUrl: 'https://api.example.com/', endpoints, fetchImpl })
    await client.perform(new NamedRequest('getBalance'), { accountId: 'a/1', currency: 'IDR' })
    await client.perform(new NamedRequest('createTransfer'), { amount: 150000 })
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/accounts/a%2F1/balance?currency=IDR')
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.example.com/transfers')
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).body).toBe('{"amount":150000}')
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).credentials).toBe('omit')
  })

  it('an unknown name fails closed without a request', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response(200, {}))
    const client = fetchNetworkClient({ baseUrl: 'https://api.example.com', endpoints, fetchImpl })
    await expect(client.perform(new NamedRequest('https://evil.example.com'), {})).rejects.toMatchObject({ kind: 'unknownRequest' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('token pattern B: async headers, one refresh + retry on 401', async () => {
    const getHeaders = vi.fn(async ({ refresh }: { refresh: boolean }) => ({ Authorization: refresh ? 'Bearer new' : 'Bearer old' }))
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      (init!.headers as Record<string, string>).Authorization === 'Bearer old' ? response(401, {}) : response(200, { amount: 1 }))
    const client = fetchNetworkClient({ baseUrl: 'https://api.example.com', endpoints, getHeaders, fetchImpl })
    expect(utf8String(await client.perform(new NamedRequest('getBalance'), { accountId: '1' }))).toBe('{"amount":1}')
    expect(getHeaders.mock.calls.map((c) => c[0].refresh)).toEqual([false, true])
  })

  it('maps the universal-service error contract; transport failure → network', async () => {
    const client = fetchNetworkClient({ baseUrl: 'x', endpoints, fetchImpl: async () => response(409, { errorDesc: 'Conflict', errorCode: 'SDUI-004', errorMessage: 'stale' }) })
    await expect(client.perform(new NamedRequest('createTransfer'), {})).rejects.toSatisfy((e: unknown) =>
      e instanceof SduiError && e.kind === 'http' && e.status === 409 && e.serverCode === 'SDUI-004' && e.detail === 'stale')
    const offline = fetchNetworkClient({ baseUrl: 'x', endpoints, fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    await expect(offline.perform(new NamedRequest('createTransfer'), {})).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('universalScreenProvider', () => {
  it('GET /client/page/{merchant}/{key}; 404 → unknownScreen', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => (String(url).endsWith('/ghost') ? response(404, {}) : response(200, { schemaVersion: '1.1' })))
    const provider = universalScreenProvider({ baseUrl: '/api/universal/v1', merchantId: 'merchant_demo', fetchImpl })
    await provider('home')
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/universal/v1/client/page/merchant_demo/home')
    await expect(provider('ghost')).rejects.toMatchObject({ kind: 'unknownScreen' })
  })
})
