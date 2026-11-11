import type { SignatureVerifier } from '../ports'

/// The crypto toggle. Development accepts unsigned payloads; production requires
/// a verified signature — insecure-by-default *by name*, so an unsigned
/// production build is obvious in review.
export type PayloadSecurity =
  /// DEVELOPMENT ONLY — accept a bare payload, or an envelope whose signature is
  /// NOT checked. Never ship this to production.
  | { readonly kind: 'insecureDevelopment' }
  /// Production — require a signed envelope and verify it before trusting.
  | { readonly kind: 'signed'; readonly verifier: SignatureVerifier }

export const PayloadSecurity = {
  insecureDevelopment: { kind: 'insecureDevelopment' } as PayloadSecurity,
  signed(verifier: SignatureVerifier): PayloadSecurity { return { kind: 'signed', verifier } }
}
