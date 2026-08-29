import type { BeeLike } from "@jytextiles/mikrohyperbee";

/**
 * An in-memory `BeeLike` — the whole surface the CRM repositories use, backed by
 * a sorted Map instead of a Hyperbee (#1648).
 *
 * WHY THIS EXISTS: the embedded store is single-writer and the lock is a FILE
 * (`hypercore-storage` opens RocksDB with a `CORESTORE` device file). Every Jest
 * worker shared one store path, so a second CRM spec landing in a second worker
 * failed the whole module with "File descriptor could not be locked" and every
 * `/admin/crm/*` route answered 500.
 *
 * ⚠️ There is NO RAM storage on this stack — corestore@7.11 → hypercore-storage@3
 * is RocksDB-only, so the memory swap cannot live inside Corestore. It lives
 * here, above it, where the DAL boundary is already a plain interface.
 *
 * Values are stored VERBATIM. Real Hyperbee subs are created with a valueEncoding
 * (`binary` for records, `utf-8` for indexes), so a put returns the same type it
 * was given; keeping values untouched reproduces that without encoding at all.
 *
 * Not durable, not for production — the loader only reaches this when the store
 * is explicitly `:memory:`.
 */
class MemoryBee implements BeeLike {
  constructor(
    private readonly map: Map<string, any> = new Map(),
    private readonly prefix: string = ""
  ) {}

  sub(name: string): BeeLike {
    // Prefix, not a nested container: ranges are compared with the same prefix
    // applied on both ends, so it cancels and ordering is preserved.
    return new MemoryBee(this.map, `${this.prefix}${name}\x00`);
  }

  async put(key: string, value: any): Promise<void> {
    this.map.set(this.prefix + key, value);
  }

  async get(key: string): Promise<{ key: string; value: any } | null> {
    const k = this.prefix + key;
    if (!this.map.has(k)) return null;
    return { key, value: this.map.get(k) };
  }

  async del(key: string): Promise<void> {
    this.map.delete(this.prefix + key);
  }

  async *createReadStream(range?: {
    gte?: string;
    lt?: string;
    gt?: string;
    lte?: string;
  }): AsyncIterable<{ key: string; value: any }> {
    const { gte, lt, gt, lte } = range || {};
    const keys = [...this.map.keys()]
      .filter((k) => k.startsWith(this.prefix))
      .sort();
    // Snapshot the key list first: callers delete while iterating.
    for (const full of keys) {
      const key = full.slice(this.prefix.length);
      if (gte !== undefined && key < gte) continue;
      if (gt !== undefined && key <= gt) continue;
      if (lte !== undefined && key > lte) continue;
      if (lt !== undefined && key >= lt) continue;
      if (!this.map.has(full)) continue;
      yield { key, value: this.map.get(full) };
    }
  }
}

export const MEMORY_STORE = ":memory:";

export function createMemoryBee(): BeeLike {
  return new MemoryBee();
}
