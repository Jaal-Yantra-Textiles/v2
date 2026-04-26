type CacheEntry = {
  value: any
  expiresAt: number
}

class StatsCache {
  private store = new Map<string, CacheEntry>()

  get(key: string): any | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: any, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }

  clear(): void {
    this.store.clear()
  }
}

export const statsCache = new StatsCache()

export function hashOptions(options: unknown): string {
  try {
    return JSON.stringify(options, Object.keys(options as object).sort())
  } catch {
    return String(options)
  }
}
