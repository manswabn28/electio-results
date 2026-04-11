type CacheRecord<T> = {
  value: T;
  expiresAt: number;
  writtenAt: number;
};

export class TtlCache<T> {
  private readonly records = new Map<string, CacheRecord<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      return undefined;
    }
    return record.value;
  }

  getStale(key: string): T | undefined {
    return this.records.get(key)?.value;
  }

  set(key: string, value: T): void {
    const now = Date.now();
    this.records.set(key, { value, writtenAt: now, expiresAt: now + this.ttlMs });
  }

  clear(): void {
    this.records.clear();
  }
}
