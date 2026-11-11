/// At-rest encryption for cached bytes (Strategy). The default is a no-op;
/// adopters flip on an encrypting implementation when payloads are sensitive.
export interface CacheCipher {
  seal(plaintext: Uint8Array): Promise<Uint8Array> | Uint8Array
  open(ciphertext: Uint8Array): Promise<Uint8Array> | Uint8Array
}

/// No encryption — cached bytes are stored as-is (still origin-isolated by the browser).
export class PassthroughCipher implements CacheCipher {
  seal(plaintext: Uint8Array): Uint8Array { return plaintext }
  open(ciphertext: Uint8Array): Uint8Array { return ciphertext }
}
