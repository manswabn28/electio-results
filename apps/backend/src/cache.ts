type CacheRecord<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache<T> {
  private readonly records = new Map<string, CacheRecord<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      this.records.delete(key);
      return undefined;
    }
    return record.value;
  }

  set(key: string, value: T): void {
    this.records.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.records.clear();
  }
}
