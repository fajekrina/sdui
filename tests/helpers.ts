import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { SduiEnvelope, sortedJSONStringify, utf8, type Bytes } from '../src/core'

/// The package root (vitest runs from it).
export const ROOT = process.cwd()

/// Bytes of a spec fixture (relative to `spec/fixtures`, e.g. `valid/dashboard.json`).
export function fixture(relativePath: string): Bytes {
  return new Uint8Array(readFileSync(resolve(ROOT, 'spec/fixtures', relativePath)))
}

export function fixtureJSON(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(ROOT, 'spec/fixtures', relativePath), 'utf8'))
}

export function fixtureNames(kind: 'valid' | 'invalid'): string[] {
  return readdirSync(resolve(ROOT, 'spec/fixtures', kind)).filter((f) => f.endsWith('.json')).sort()
}

export interface SigningKey {
  publicKey: Uint8Array
  sign(data: Uint8Array): Promise<Uint8Array>
}

/// A fresh Ed25519 key pair (the test-side signer; signing is server-side in production).
export async function signingKey(): Promise<SigningKey> {
  const subtle = globalThis.crypto.subtle
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
  return {
    publicKey,
    sign: async (data) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(data)))
  }
}

export function envelopeJSON(payload: Uint8Array, signature: Uint8Array, keyId?: string): Bytes {
  return utf8(sortedJSONStringify(new SduiEnvelope('1.1', 'ed25519', payload, signature, { keyId })))
}

export class Counter {
  count = 0
  bump() { this.count += 1 }
}

/// Wait for pending promises/microtasks.
export const flush = () => new Promise((r) => setTimeout(r, 0))
