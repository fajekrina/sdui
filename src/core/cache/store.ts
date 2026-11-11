/// Persistent byte store for the disk cache (Strategy).
export interface CacheStore {
  data(key: string): Promise<Uint8Array | undefined>
  store(data: Uint8Array, key: string): Promise<void>
  remove(key: string): Promise<void>
}

/// In-memory store — the default for tests and previews (not persisted).
export class MemoryCacheStore implements CacheStore {
  private readonly storage = new Map<string, Uint8Array>()
  async data(key: string): Promise<Uint8Array | undefined> { return this.storage.get(key) }
  async store(data: Uint8Array, key: string): Promise<void> { this.storage.set(key, data) }
  async remove(key: string): Promise<void> { this.storage.delete(key) }
}
