import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

import { MedusaError } from "@medusajs/framework/utils";

/**
 * Hyperbee-backed internal model service for `person_property` — the "MikroHyperbee"
 * DAL. It implements exactly the surface Medusa's generated PersonPropertyService
 * (`MedusaService({ PersonProperty })`) calls on the injected internal service
 * `container.personPropertyService`, so the REAL generated
 * create/list/listAndCount/retrieve/update/delete methods run over Hyperbee with
 * no Postgres / MikroORM.
 *
 * Proven end-to-end against the real service class in the MikroHyperbee spike
 * (scripts/handloom-scrape/hyperbee-slice/person-property-medusa-e2e.ts, 11/11).
 * This is that HyperbeeModelService ported into the module, typed.
 *
 * Records live in the `rec` sub (brotli-compressed JSON); equality-filterable
 * fields get a secondary `idx` sub (`field/value/id -> id`) for indexed lookups;
 * everything else falls back to a full scan + in-memory match.
 */

// Fields we maintain a secondary index for (the ones weavers are segmented by).
const INDEXED = [
  "profile_type",
  "social_group",
  "district",
  "region_state",
  "gender",
  "own_looms",
] as const;

type Where = Record<string, unknown>;
type ListConfig = { take?: number; skip?: number; order?: Record<string, string> };

const matches = (row: Record<string, any>, where: Where = {}): boolean =>
  Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object") {
      const c = cond as Record<string, any>;
      if ("$in" in c) return c.$in.includes(v);
      if ("$ne" in c) return v !== c.$ne;
      if ("$gt" in c) return v > c.$gt;
      if ("$gte" in c) return v >= c.$gte;
      if ("$lt" in c) return v < c.$lt;
      if ("$lte" in c) return v <= c.$lte;
    }
    return v === cond;
  });

export class HyperbeePersonPropertyService {
  private recs: any;
  private idx: any;
  private seq = 0;

  constructor(bee: any) {
    this.recs = bee.sub("rec", { valueEncoding: "binary" });
    this.idx = bee.sub("idx", { valueEncoding: "utf-8" });
  }

  private enc(o: unknown): Buffer {
    return brotliCompressSync(Buffer.from(JSON.stringify(o)));
  }
  private dec(b: Buffer): any {
    return JSON.parse(brotliDecompressSync(b).toString());
  }
  // Deterministic id (no Date.now/Math.random — keeps replicas byte-identical).
  private nextId(): string {
    return `pp_${String(++this.seq).padStart(6, "0")}`;
  }

  private async index(row: Record<string, any>): Promise<void> {
    for (const f of INDEXED) {
      if (row[f] !== undefined && row[f] !== null) {
        await this.idx.put(`${f}/${String(row[f])}/${row.id}`, row.id);
      }
    }
  }
  private async deindex(row: Record<string, any>): Promise<void> {
    for (const f of INDEXED) {
      if (row[f] !== undefined && row[f] !== null) {
        await this.idx.del(`${f}/${String(row[f])}/${row.id}`);
      }
    }
  }
  private async get(id: string): Promise<any | null> {
    const node = await this.recs.get(String(id));
    return node ? this.dec(node.value) : null;
  }

  // ── surface Medusa's generated methods invoke on the internal service ──

  async create(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const d of arr) {
      const row = { id: d.id || this.nextId(), ...d };
      await this.recs.put(row.id, this.enc(row));
      await this.index(row);
      out.push(row);
    }
    return Array.isArray(data) ? out : out[0];
  }

  async retrieve(id: string): Promise<any> {
    const r = await this.get(id);
    if (!r) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `PersonProperty with id: ${id} was not found`
      );
    }
    return r;
  }

  // Resolve a where-clause to candidate ids, intersecting secondary indexes when
  // the filter uses indexed equality; otherwise scan all record keys.
  private async candidateIds(where: Where = {}): Promise<string[]> {
    const eqIndexed = Object.entries(where).filter(
      ([k, v]) =>
        (INDEXED as readonly string[]).includes(k) &&
        (typeof v !== "object" || v === null)
    );
    if (eqIndexed.length) {
      const sets = await Promise.all(
        eqIndexed.map(async ([k, v]) => {
          const s = new Set<string>();
          const p = `${k}/${String(v)}/`;
          for await (const { value: id } of this.idx.createReadStream({
            gte: p,
            lt: p + "~",
          })) {
            s.add(id);
          }
          return s;
        })
      );
      return [...sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))];
    }
    const ids: string[] = [];
    for await (const { key } of this.recs.createReadStream()) ids.push(key);
    return ids;
  }

  private async resolve(filters: Where): Promise<any[]> {
    const ids = await this.candidateIds(filters);
    const rows: any[] = [];
    for (const id of ids) {
      const r = await this.get(id);
      if (r && matches(r, filters)) rows.push(r);
    }
    return rows;
  }

  async list(filters: Where = {}, config: ListConfig = {}): Promise<any[]> {
    const rows = await this.resolve(filters);
    const { take = 15, skip = 0, order } = config || {};
    if (order) {
      const [f, dir] = Object.entries(order)[0] as [string, string];
      const sign = String(dir).toUpperCase() === "DESC" ? -1 : 1;
      rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * sign);
    } else {
      rows.sort((a, b) => (a.id > b.id ? 1 : -1));
    }
    return rows.slice(skip, skip + take);
  }

  async listAndCount(
    filters: Where = {},
    config: ListConfig = {}
  ): Promise<[any[], number]> {
    const count = (await this.resolve(filters)).length;
    return [await this.list(filters, config), count];
  }

  async update(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const d of arr) {
      const cur = await this.retrieve(d.id);
      await this.deindex(cur);
      const row = { ...cur, ...d };
      await this.recs.put(row.id, this.enc(row));
      await this.index(row);
      out.push(row);
    }
    return Array.isArray(data) ? out : out[0];
  }

  async delete(pks: string | string[]): Promise<void> {
    const ids = Array.isArray(pks) ? pks : [pks];
    for (const id of ids) {
      const cur = await this.get(id);
      if (cur) {
        await this.deindex(cur);
        await this.recs.del(id);
      }
    }
  }

  // A KV store has no soft-delete/restore semantics; return the empty shapes the
  // generated service expects. (Onboarded person_property records are few and
  // hard-deleted; the append-only history lives in the core itself.)
  async softDelete(): Promise<[any[], Record<string, unknown>]> {
    return [[], {}];
  }
  async restore(): Promise<[any[], Record<string, unknown>]> {
    return [[], {}];
  }
}

export default HyperbeePersonPropertyService;
