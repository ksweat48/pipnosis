interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const STALE_TTL = 10_000; // 10 seconds - data considered fresh
const cache = new Map<string, CacheEntry<unknown>>();

export const navigationDataCache = {
  get<T>(key: string): T | null {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > STALE_TTL) return null;
    return entry.data;
  },

  getStale<T>(key: string): T | null {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    return entry?.data ?? null;
  },

  isFresh(key: string): boolean {
    const entry = cache.get(key);
    if (!entry) return false;
    return Date.now() - entry.timestamp <= STALE_TTL;
  },

  set<T>(key: string, data: T): void {
    cache.set(key, { data, timestamp: Date.now() });
  },

  invalidate(key: string): void {
    cache.delete(key);
  },

  clear(): void {
    cache.clear();
  }
};
