import { SduiError } from '../core/errors'
import { SduiEnvelope, parseJSON } from '../core/payload'
import { hex, type BytesLike, toBytes } from '../core/bytes'
import type { SignatureVerifier } from '../ports'

/// The signed description of a downloadable web bundle. CI produces it
/// (`scripts/sign-bundle.mjs`) and signs it with the BUNDLE key (not the payload
/// key); the host verifies it before serving any file from its local origin.
export interface BundleManifest {
  version: string
  /// monotonic: an older sequence is rejected (anti-rollback)
  sequence: number
  /// path → hex SHA-256 of the file bytes
  files: Record<string, string>
  /// lowest bridge protocol / host app version the bundle needs
  minBridge: number
  minHost: string
}

/// Verify a signed bundle manifest envelope and every file's hash. Returns the
/// manifest, or throws `SduiError` (signature, rollback, hash, compatibility).
/// This is the reference implementation of the host-side check; Android/iOS
/// hosts port the same steps natively.
export async function verifyBundleManifest(input: {
  envelope: BytesLike
  files: Record<string, BytesLike>
  verifier: SignatureVerifier
  lastSequence?: number
  bridgeVersion: number
  sha256: (data: Uint8Array) => Promise<Uint8Array>
}): Promise<BundleManifest> {
  const envelope = SduiEnvelope.decode(parseJSON(input.envelope))
  if (!(await input.verifier.verify(envelope.payload, envelope.signature, envelope.keyId))) throw SduiError.signatureInvalid()
  const manifest = parseJSON(envelope.payload) as BundleManifest
  if (typeof manifest.sequence !== 'number' || typeof manifest.files !== 'object' || manifest.files === null) {
    throw SduiError.decode('bundle manifest: malformed')
  }
  if (input.lastSequence !== undefined && manifest.sequence < input.lastSequence) {
    throw SduiError.rollback(`bundle sequence ${manifest.sequence} < ${input.lastSequence}`)
  }
  if (typeof manifest.minBridge === 'number' && manifest.minBridge > input.bridgeVersion) {
    throw SduiError.unsupportedVersion(`bridge ${manifest.minBridge}`)
  }
  for (const [path, expected] of Object.entries(manifest.files)) {
    const file = input.files[path]
    if (file === undefined) throw SduiError.decode(`bundle file missing: ${path}`)
    if (hex(await input.sha256(toBytes(file))) !== expected) throw SduiError.signatureInvalid()
  }
  return manifest
}
