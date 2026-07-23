/**
 * HyperbeeBaseRepository — the generalized MikroHyperbee DAL.
 *
 * Generalizes the proven person_property DAL into a contract-driven repository
 * over Hyperbee sub-dbs. Implements the ModelRepository surface that Medusa's
 * generated methods invoke on the injected internal service, so satisfying it =
 * the storage swap (no Postgres / MikroORM).
 *
 * Sub-dbs:
 *   rec   key -> brotli(JSON)                  the records (key = generated id or composite PK)
 *   idx   field/value/key -> key               equality secondary indexes
 *   uniq  field/value -> key                   uniqueness reservations
 *   idemp natkey -> key                         idempotency (natural-key dedupe)
 *   meta  seq -> "<n>"                          persisted id counter
 *
 * Writes run the staged contract: Shape → Identity → Uniqueness → Referential →
 * Invariants → Commit (record + secondary + unique indexes maintained together).
 */
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

import { applyShape, checkInvariants } from "./contract";
import {
  BeeLike,
  Contract,
  ContractError,
  ListConfig,
  ModelRepository,
  RepositoryContext,
  Where,
} from "./types";

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const matches = (row: Record<string, any>, where: Where = {}): boolean =>
  Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    // A bare array is IN-membership — this is the shape query.graph uses to load
    // linked records (`{ id: [id1, id2] }`), so it must resolve, not fall through.
    if (Array.isArray(cond)) return cond.includes(v);
    if (cond && typeof cond === "object") {
      const c = cond as Record<string, any>;
      // Unknown/opaque operator values (e.g. a Postgres raw() predicate) never
      // match — a filter we can't evaluate is treated as "no rows", never "all".
      if ("$in" in c) return Array.isArray(c.$in) && c.$in.includes(v);
      // $ne: null is a real filter; only an opaque object (e.g. raw()) is unevaluable.
      if ("$ne" in c) return c.$ne !== null && typeof c.$ne === "object" ? true : v !== c.$ne;
      if ("$gt" in c) return typeof c.$gt !== "object" && (v as any) > c.$gt;
      if ("$gte" in c) return typeof c.$gte !== "object" && (v as any) >= c.$gte;
      if ("$lt" in c) return typeof c.$lt !== "object" && (v as any) < c.$lt;
      if ("$lte" in c) return typeof c.$lte !== "object" && (v as any) <= c.$lte;
      return false;
    }
    return v === cond;
  });

export class HyperbeeBaseRepository implements ModelRepository {
  private recs: BeeLike;
  private idx: BeeLike;
  private uniq: BeeLike;
  private idemp: BeeLike;
  private meta: BeeLike;
  private seq: number | null = null;

  private readonly indexed: string[];
  private readonly uniques: string[];
  /** Natural/composite PK fields, or null → generated id. */
  private readonly pk: string[] | null;

  constructor(
    private bee: BeeLike,
    private contract: Contract,
    private ctx: RepositoryContext = {}
  ) {
    this.recs = bee.sub("rec", { valueEncoding: "binary" });
    this.idx = bee.sub("idx", { valueEncoding: "utf-8" });
    this.uniq = bee.sub("uniq", { valueEncoding: "utf-8" });
    this.idemp = bee.sub("idemp", { valueEncoding: "utf-8" });
    this.meta = bee.sub("meta", { valueEncoding: "utf-8" });

    this.pk =
      contract.primaryKey && contract.primaryKey.length
        ? [...contract.primaryKey]
        : null;

    const relKeys = Object.values(contract.relations ?? {})
      .filter((r) => r.kind === "belongsTo")
      .map((r) => r.key);
    // Composite PK fields are indexed too, so list-by-partial-key works.
    this.indexed = [
      ...new Set([...(contract.indexes ?? []), ...relKeys, ...(this.pk ?? [])]),
    ];
    this.uniques = [...(contract.unique ?? [])];
  }

  // ── encoding + keys ─────────────────────────────────────────────────────────
  private enc(o: unknown): Buffer {
    return brotliCompressSync(Buffer.from(JSON.stringify(o)));
  }
  private dec(b: Buffer): any {
    return JSON.parse(brotliDecompressSync(b).toString());
  }
  /** Storage key for a record: composite PK joined, or the generated/explicit id. */
  private keyOf(row: Record<string, any>): string {
    if (this.pk) {
      const missing = this.pk.filter((k) => row[k] === undefined || row[k] === null);
      if (missing.length) {
        throw new ContractError(
          "invalid_data",
          `${this.contract.model} missing primary-key field(s): ${missing.join(", ")}`
        );
      }
      return this.pk.map((k) => String(row[k])).join(":");
    }
    return String(row.id);
  }
  /**
   * Stamp created_at/updated_at the way every Medusa DML model does, so records
   * served through the generated service + query.graph carry the timestamps
   * downstream code (and `order: {updated_at}`) expects. Opt out with
   * `timestamps: false`. Mutates and returns `row`.
   */
  private stamp(row: Record<string, any>, existing: any | null): Record<string, any> {
    if (this.contract.timestamps === false) return row;
    const now = new Date().toISOString();
    if (existing) {
      row.created_at = existing.created_at ?? row.created_at ?? now;
      row.updated_at = now;
    } else {
      row.created_at = row.created_at ?? now;
      row.updated_at = row.updated_at ?? now;
    }
    if (row.deleted_at === undefined) row.deleted_at = null;
    return row;
  }
  private async ensureSeq(): Promise<void> {
    if (this.seq !== null) return;
    const node = await this.meta.get("seq");
    this.seq = node ? parseInt(String(node.value), 10) || 0 : 0;
  }
  private async nextId(): Promise<string> {
    await this.ensureSeq();
    this.seq = (this.seq as number) + 1;
    await this.meta.put("seq", String(this.seq));
    const prefix = this.contract.id?.prefix ?? this.contract.model;
    return `${prefix}_${String(this.seq).padStart(6, "0")}`;
  }

  // ── index maintenance (pointer = storage key) ────────────────────────────────
  private async index(row: Record<string, any>, key: string): Promise<void> {
    for (const f of this.indexed) {
      const v = row[f];
      if (v !== undefined && v !== null) await this.idx.put(`${f}/${String(v)}/${key}`, key);
    }
  }
  private async deindex(row: Record<string, any>, key: string): Promise<void> {
    for (const f of this.indexed) {
      const v = row[f];
      if (v !== undefined && v !== null) await this.idx.del(`${f}/${String(v)}/${key}`);
    }
  }

  // ── uniqueness (stage 3) ─────────────────────────────────────────────────────
  private uniqKey(field: string, value: unknown): string {
    return `${field}/${String(value)}`;
  }
  private async assertUnique(row: Record<string, any>, key: string): Promise<void> {
    for (const f of this.uniques) {
      const v = row[f];
      if (v === undefined || v === null) continue;
      const node = await this.uniq.get(this.uniqKey(f, v));
      if (node && node.value !== key) {
        throw new ContractError(
          "not_unique",
          `${this.contract.model}.${f} must be unique — '${v}' already used`
        );
      }
    }
  }
  private async reserveUnique(row: Record<string, any>, key: string): Promise<void> {
    for (const f of this.uniques) {
      const v = row[f];
      if (v !== undefined && v !== null) await this.uniq.put(this.uniqKey(f, v), key);
    }
  }
  private async releaseUnique(row: Record<string, any>): Promise<void> {
    for (const f of this.uniques) {
      const v = row[f];
      if (v !== undefined && v !== null) await this.uniq.del(this.uniqKey(f, v));
    }
  }

  // ── referential (stage 4) ────────────────────────────────────────────────────
  private async assertReferential(row: Record<string, any>): Promise<void> {
    for (const rel of Object.values(this.contract.relations ?? {})) {
      if (rel.kind !== "belongsTo") continue;
      const targetId = row[rel.key];
      if (targetId === undefined || targetId === null) continue;
      if ((rel.integrity ?? "soft") === "strict") {
        if (!this.ctx.exists) {
          throw new ContractError(
            "not_allowed",
            `relation '${rel.key}' is strict but no exists() resolver is configured`
          );
        }
        const okExists = await this.ctx.exists(rel.target, String(targetId));
        if (!okExists) {
          throw new ContractError(
            "not_found",
            `${this.contract.model}.${rel.key} -> ${rel.target}:${targetId} does not exist`
          );
        }
      }
    }
  }

  private async get(key: string): Promise<any | null> {
    const node = await this.recs.get(String(key));
    return node ? this.dec(node.value) : null;
  }

  /** Shared write path for create/upsert. `existing` non-null → update-in-place. */
  private async write(input: any, existing: any | null): Promise<any> {
    const base = existing ? { ...existing, ...input } : input;
    const { row: shaped } = applyShape(this.contract, base);

    let row: Record<string, any>;
    if (existing) {
      row = { ...shaped };
    } else if (this.pk) {
      row = { ...shaped, id: input.id ?? undefined };
    } else {
      row = { id: input.id || (await this.nextId()), ...shaped };
    }
    const key = this.keyOf(row);
    if (this.pk && row.id === undefined) row.id = key;
    this.stamp(row, existing);

    await this.assertUnique(row, key);
    await this.assertReferential(row);
    checkInvariants(this.contract, row);

    if (existing) {
      await this.deindex(existing, key);
      await this.releaseUnique(existing);
    }
    await this.recs.put(key, this.enc(row));
    await this.index(row, key);
    await this.reserveUnique(row, key);
    return row;
  }

  // ── ModelRepository surface ──────────────────────────────────────────────────

  async create(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const input of arr) {
      const { row: shaped } = applyShape(this.contract, input);
      const idemKey = this.contract.idempotencyKey?.(shaped);
      if (idemKey) {
        const existing = await this.idemp.get(idemKey);
        if (existing) {
          const prev = await this.get(String(existing.value));
          if (prev) {
            out.push(prev);
            continue;
          }
        }
      }
      const row = await this.write(input, null);
      if (idemKey) await this.idemp.put(idemKey, this.keyOf(row));
      out.push(row);
    }
    return Array.isArray(data) ? out : out[0];
  }

  async upsert(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const input of arr) {
      const { row: probe } = applyShape(this.contract, input);
      const key = this.keyOf(probe);
      const existing = await this.get(key);
      out.push(await this.write(input, existing));
    }
    return Array.isArray(data) ? out : out[0];
  }

  async retrieve(id: string): Promise<any> {
    const r = await this.get(id);
    if (!r) {
      throw new ContractError(
        "not_found",
        `${this.contract.model} with id: ${id} was not found`
      );
    }
    return r;
  }

  private async candidateKeys(where: Where = {}): Promise<string[]> {
    // Fast path: filtering by the record key itself. `id` always equals the
    // storage key (generated id, or the composite PK we mirror onto row.id), so
    // an id / [ids] / {$in:[ids]} filter resolves to those keys directly — this
    // is exactly how query.graph loads linked records. resolve() re-applies the
    // full `where` (incl. any other predicates) via matches(), so returning the
    // id set as candidates is a correct superset.
    const idc: any = (where as any).id;
    if (idc !== undefined) {
      const ids =
        typeof idc === "string"
          ? [idc]
          : Array.isArray(idc)
          ? idc.map(String)
          : idc && typeof idc === "object" && Array.isArray(idc.$in)
          ? idc.$in.map(String)
          : null;
      if (ids && ids.length) return ids;
    }
    const eqIndexed = Object.entries(where).filter(
      ([k, v]) => this.indexed.includes(k) && (typeof v !== "object" || v === null)
    );
    if (eqIndexed.length) {
      const sets = await Promise.all(
        eqIndexed.map(async ([k, v]) => {
          const s = new Set<string>();
          const p = `${k}/${String(v)}/`;
          for await (const { value: key } of this.idx.createReadStream({ gte: p, lt: p + "~" })) {
            s.add(key as unknown as string);
          }
          return s;
        })
      );
      return [...sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))];
    }
    const keys: string[] = [];
    for await (const { key } of this.recs.createReadStream()) keys.push(key);
    return keys;
  }

  private async resolve(filters: Where): Promise<any[]> {
    const keys = await this.candidateKeys(filters);
    const rows: any[] = [];
    for (const key of keys) {
      const r = await this.get(key);
      if (r && matches(r, filters)) rows.push(r);
    }
    return rows;
  }

  async list(filters: Where = {}, config: ListConfig = {}): Promise<any[]> {
    const rows = await this.resolve(filters);
    const cfg = config || {};
    const skip = cfg.skip ?? 0;
    // take: undefined → default page size (15); null → no limit. Query hydrates
    // linked records with `take: null`, and `= 15` default only fires for
    // undefined — a null `take` must mean "all", never slice(skip, skip+null)=[].
    const take = cfg.take === undefined ? 15 : cfg.take;
    const order = cfg.order;
    if (order) {
      const [f, dir] = Object.entries(order)[0] as [string, string];
      const sign = String(dir).toUpperCase() === "DESC" ? -1 : 1;
      rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * sign);
    } else {
      rows.sort((a, b) => (a.id > b.id ? 1 : -1));
    }
    return take === null ? rows.slice(skip) : rows.slice(skip, skip + take);
  }

  async listAndCount(filters: Where = {}, config: ListConfig = {}): Promise<[any[], number]> {
    const count = (await this.resolve(filters)).length;
    return [await this.list(filters, config), count];
  }

  async update(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const d of arr) {
      // find by composite PK fields present on d, else by id
      const key = this.pk ? this.keyOf(d) : String(d.id);
      const cur = await this.get(key);
      if (!cur) {
        throw new ContractError(
          "not_found",
          `${this.contract.model} with key: ${key} was not found`
        );
      }
      out.push(await this.write(d, cur));
    }
    return Array.isArray(data) ? out : out[0];
  }

  async delete(selector: string | string[] | Where | Where[]): Promise<void> {
    // Normalize to a list of "targets": each is either a storage key (string)
    // or a filter/partial-key object we resolve to matching keys.
    const targets: Array<string | Where> = Array.isArray(selector)
      ? (selector as Array<string | Where>)
      : [selector as string | Where];

    const keys = new Set<string>();
    for (const t of targets) {
      if (typeof t === "string") {
        keys.add(t);
      } else if (isPlainObject(t)) {
        // A partial-key/filter object → resolve to the keys of matching rows.
        for (const row of await this.resolve(t)) keys.add(this.keyOf(row));
      }
    }
    for (const key of keys) {
      const cur = await this.get(key);
      if (cur) {
        await this.deindex(cur, key);
        await this.releaseUnique(cur);
        await this.recs.del(key);
      }
    }
  }

  async softDelete(): Promise<[any[], Record<string, unknown>]> {
    return [[], {}];
  }
  async restore(): Promise<[any[], Record<string, unknown>]> {
    return [[], {}];
  }

  // ── multi-writer fold (Autobase apply) ──────────────────────────────────────
  // Deterministic persistence of a FULLY-MATERIALIZED row (id + timestamps already
  // set by the writer). Unlike write(), it never generates an id, never re-stamps,
  // and NEVER throws — it returns an outcome so the Autobase `apply()` can record a
  // conflict and keep linearizing instead of halting. Referential integrity is NOT
  // enforced here (soft-by-default across writers, per the framework doc); flip a
  // relation to strict only inside a single-writer domain.
  //
  // Conflict policy = last-writer-wins by `updated_at` (ties → last in linear order,
  // which is deterministic because apply replays a fixed order). A uniqueness clash
  // with a *different* key, or an invariant violation, rejects the row (loser).
  async foldPut(
    row: Record<string, any>
  ): Promise<"applied" | "stale" | "rejected"> {
    const key = this.keyOf(row);
    const existing = await this.get(key);
    if (
      existing &&
      row.updated_at != null &&
      existing.updated_at != null &&
      String(row.updated_at) < String(existing.updated_at)
    ) {
      return "stale"; // an older write loses
    }
    // uniqueness: a reservation held by a DIFFERENT key means this row loses.
    for (const f of this.uniques) {
      const v = row[f];
      if (v === undefined || v === null) continue;
      const node = await this.uniq.get(this.uniqKey(f, v));
      if (node && node.value !== key) return "rejected";
    }
    try {
      checkInvariants(this.contract, row);
    } catch {
      return "rejected";
    }
    if (existing) {
      await this.deindex(existing, key);
      await this.releaseUnique(existing);
    }
    await this.recs.put(key, this.enc(row));
    await this.index(row, key);
    await this.reserveUnique(row, key);
    return "applied";
  }

  /** Deterministic delete of a materialized key (Autobase apply). Idempotent. */
  async foldDel(key: string): Promise<void> {
    const cur = await this.get(key);
    if (!cur) return;
    await this.deindex(cur, key);
    await this.releaseUnique(cur);
    await this.recs.del(key);
  }
}

/** Factory: build a repository for a contract over a ready Hyperbee. */
export function hyperbeeRepositoryFor(
  contract: Contract,
  bee: BeeLike,
  ctx?: RepositoryContext
): HyperbeeBaseRepository {
  return new HyperbeeBaseRepository(bee, contract, ctx);
}
