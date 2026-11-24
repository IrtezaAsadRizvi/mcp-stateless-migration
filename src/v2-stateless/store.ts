// The shared store. Article: "the shared state didn't vanish, it moved."
//
// Every replica must talk to the SAME store (Redis, Postgres, DynamoDB...).
// We ship an in-memory version so the example runs with zero setup.
// In the demo, 3 replicas share one MemoryStore object to fake that.

export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;

  /**
   * Write only if the key doesn't exist yet. Returns true if we wrote it.
   * Must be ATOMIC: it's what stops two concurrent retries from both
   * publishing. (Redis: `SET key value NX`. SQL: INSERT ... ON CONFLICT DO NOTHING.)
   */
  setIfAbsent(key: string, value: unknown): Promise<boolean>;
}

export class MemoryStore implements Store {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async setIfAbsent(key: string, value: unknown): Promise<boolean> {
    // Safe in Node: check + write run without yielding, so nothing interleaves.
    if (this.data.has(key)) return false;
    this.data.set(key, value);
    return true;
  }
}
