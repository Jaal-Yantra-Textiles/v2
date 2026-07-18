/**
 * Autobee — multi-writer MikroHyperbee over Autobase.
 *
 * Single-writer is a property of a *hypercore*, not of this DAL. Autobase gives
 * multi-writer by event-sourcing: each writer appends ops to its OWN input core,
 * and a deterministic `apply()` linearizes every writer's ops into one Hyperbee
 * view. The read surface is unchanged — the view IS a Hyperbee, so the same
 * HyperbeeBaseRepository queries it.
 *
 * The adaptation that makes this correct:
 *   - Ops carry FULLY-MATERIALIZED rows. The writer generates the id and stamps
 *     created_at/updated_at *before* appending — because `apply()` must be a pure
 *     function of the ops (running `nextId()` or `new Date()` inside apply would
 *     make every node compute a different view → divergence).
 *   - `apply()` is a pure LWW fold (repository.foldPut/foldDel) that NEVER throws:
 *     a uniqueness clash or a stale (older updated_at) write is dropped, not
 *     raised, so the linearizer keeps converging. The "loser" simply isn't in the
 *     view — the writer learns it lost by reading its id back and not finding it.
 *
 * Consistency is eventual (this is the trade for P2P + offline + multi-writer):
 * uniqueness is resolved deterministically at merge, not synchronously at append.
 * Keep invariant-critical domains (money, inventory) on a strong store.
 *
 * The package stays storage-agnostic: the caller constructs the Autobase (wiring
 * `makeApply(contracts)` as its apply fn) and passes it in, exactly as
 * hyperbeeRepositoryFor takes a ready Hyperbee.
 */
import { applyShape } from "./contract";
import { HyperbeeBaseRepository } from "./repository";
import {
  BeeLike,
  Contract,
  ContractError,
  ListConfig,
  ModelRepository,
  RepositoryContext,
  Where,
} from "./types";

/** The minimal Autobase surface Autobee needs (structurally typed, no dep). */
export interface AutobaseLike {
  /** The linearized view — a Hyperbee (opened by the caller's `open`). */
  view: BeeLike;
  /** Append an op to THIS writer's input core. */
  append(value: any): Promise<void>;
  /** Run the linearizer so `view` reflects all known ops. */
  update(): Promise<void>;
  /** This writer's input core (its `key` authorizes it as a writer). */
  local?: { key: Buffer | Uint8Array };
}

/** Op envelope appended to a writer's input core (base `valueEncoding: "json"`). */
export type AutobeeOp =
  | { t: "put"; model: string; row: Record<string, any> }
  | { t: "del"; model: string; key: string }
  | { t: "addWriter"; key: string };

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Build the Autobase `apply(nodes, view, host)` handler for a set of contracts.
 * Deterministic: it only ever touches `view` (the sole data structure Autobase
 * can undo/reapply). Per-model repositories are cached against the view instance.
 */
export function makeApply(
  contracts: Record<string, Contract>,
  ctx: RepositoryContext = {}
) {
  let repos: Record<string, HyperbeeBaseRepository> | null = null;
  let boundView: unknown = null;

  return async function apply(nodes: any[], view: BeeLike, host: any): Promise<void> {
    if (boundView !== view) {
      boundView = view;
      repos = {};
      for (const [model, contract] of Object.entries(contracts)) {
        // Each model gets its OWN sub-bee on the view so rec/idx/uniq are isolated
        // per entity — else a shared index (e.g. company_id) cross-links models and
        // a list of one model returns another's rows. MUST match the read side.
        repos[model] = new HyperbeeBaseRepository(view.sub(model), contract, ctx);
      }
    }
    for (const node of nodes) {
      const op = node?.value as AutobeeOp | undefined;
      if (!op || typeof op !== "object") continue;
      if (op.t === "addWriter") {
        await host.addWriter(Buffer.from(op.key, "hex"), { indexer: true });
        continue;
      }
      const repo = repos![op.model];
      if (!repo) continue;
      if (op.t === "put") await repo.foldPut(op.row);
      else if (op.t === "del") await repo.foldDel(op.key);
    }
  };
}

/**
 * A ModelRepository whose writes go through Autobase (append → deterministic
 * apply) and whose reads hit the linearized Hyperbee view. Same public surface as
 * HyperbeeBaseRepository, so routes/workflows can't tell which backend they're on.
 */
export class AutobeeRepository implements ModelRepository {
  private reader: HyperbeeBaseRepository | null = null;
  private tag: string | null = null;
  private counter = 0;

  constructor(
    private base: AutobaseLike,
    private contract: Contract,
    private ctx: RepositoryContext = {}
  ) {}

  /** Read path: the same contract-driven repository, bound to the linearized view. */
  private read(): HyperbeeBaseRepository {
    if (!this.reader) {
      // Same per-model sub-bee the apply-fold writes into (view.sub(model)), so
      // reads see this entity's rec/idx/uniq only — never another model's.
      this.reader = new HyperbeeBaseRepository(
        this.base.view.sub(this.contract.model),
        this.contract,
        this.ctx
      );
    }
    return this.reader;
  }

  /** Writer-unique id: `<prefix>_<writerTag><base36 counter>` — collision-free
   *  across writers without coordination (each writer's core key is unique). */
  private writerTag(): string {
    if (this.tag === null) {
      const k = this.base.local?.key;
      this.tag = k ? Buffer.from(k).toString("hex").slice(0, 8) : "local";
    }
    return this.tag;
  }
  private genId(explicit?: string): string {
    if (explicit) return explicit;
    const prefix = this.contract.id?.prefix ?? this.contract.model;
    this.counter += 1;
    return `${prefix}_${this.writerTag()}${this.counter.toString(36).padStart(4, "0")}`;
  }

  /** Fully materialize a row at the writer (id + timestamps), so `apply()` stays
   *  a pure function of the op. */
  private materialize(input: any, existing: any | null): Record<string, any> {
    const merged = existing ? { ...existing, ...input } : input;
    const { row: shaped } = applyShape(this.contract, merged);
    const row: Record<string, any> = { ...shaped };
    row.id = existing ? existing.id : this.genId(input.id);
    if (this.contract.timestamps !== false) {
      const now = new Date().toISOString();
      row.created_at = existing ? existing.created_at : input.created_at ?? now;
      row.updated_at = now;
      if (row.deleted_at === undefined) row.deleted_at = null;
    }
    return row;
  }

  private async commit(row: Record<string, any>): Promise<void> {
    await this.base.append({ t: "put", model: this.contract.model, row });
    await this.base.update();
  }

  async create(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const input of arr) {
      const row = this.materialize(input, null);
      await this.commit(row);
      // Read our id back from the linearized view: present → we won; absent → our
      // write lost a uniqueness race (deterministic loser). Surfaced as not_unique.
      try {
        out.push(await this.read().retrieve(row.id));
      } catch {
        throw new ContractError(
          "not_unique",
          `${this.contract.model} create rejected — a conflicting record won linearization`
        );
      }
    }
    return Array.isArray(data) ? out : out[0];
  }

  async update(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const d of arr) {
      const existing = await this.read().retrieve(String(d.id)); // throws not_found
      const row = this.materialize(d, existing);
      await this.commit(row);
      out.push(await this.read().retrieve(row.id));
    }
    return Array.isArray(data) ? out : out[0];
  }

  async upsert(data: any): Promise<any> {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const input of arr) {
      const existing = input.id
        ? await this.read().retrieve(String(input.id)).catch(() => null)
        : null;
      const row = this.materialize(input, existing);
      await this.commit(row);
      out.push(await this.read().retrieve(row.id));
    }
    return Array.isArray(data) ? out : out[0];
  }

  async delete(selector: string | string[] | Where | Where[]): Promise<void> {
    const targets: Array<string | Where> = Array.isArray(selector)
      ? (selector as Array<string | Where>)
      : [selector as string | Where];
    const keys = new Set<string>();
    for (const t of targets) {
      if (typeof t === "string") keys.add(t);
      else if (isPlainObject(t)) {
        for (const row of await this.read().list(t, { take: null })) keys.add(String(row.id));
      }
    }
    for (const key of keys) {
      await this.base.append({ t: "del", model: this.contract.model, key });
    }
    if (keys.size) await this.base.update();
  }

  // ── reads delegate to the view-bound repository ──────────────────────────────
  retrieve(id: string): Promise<any> {
    return this.read().retrieve(id);
  }
  list(filters?: Where, config?: ListConfig): Promise<any[]> {
    return this.read().list(filters, config);
  }
  listAndCount(filters?: Where, config?: ListConfig): Promise<[any[], number]> {
    return this.read().listAndCount(filters, config);
  }
  softDelete(): Promise<[any[], Record<string, unknown>]> {
    return this.read().softDelete();
  }
  restore(): Promise<[any[], Record<string, unknown>]> {
    return this.read().restore();
  }
}

/** Factory: a multi-writer repository for a contract over a ready Autobase. */
export function autobeeRepositoryFor(
  contract: Contract,
  base: AutobaseLike,
  ctx?: RepositoryContext
): AutobeeRepository {
  return new AutobeeRepository(base, contract, ctx);
}

/** Membership: append an `addWriter` op authorizing `writerKey` (from another
 *  base's `local.key`). Only an existing writer/indexer may do this. */
export async function authorizeWriter(
  base: AutobaseLike,
  writerKey: Buffer | Uint8Array
): Promise<void> {
  await base.append({ t: "addWriter", key: Buffer.from(writerKey).toString("hex") });
  await base.update();
}
