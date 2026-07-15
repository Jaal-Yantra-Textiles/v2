/**
 * MikroHyperbee — core types.
 *
 * The core is deliberately Medusa-free: it knows nothing about DML, awilix, or
 * MedusaService. A thin adapter (later) derives a Contract from a DML model and
 * wires the repository into a module container. Here we speak only in plain
 * records, a Contract, and a minimal Hyperbee surface.
 */

export type FieldType = "string" | "number" | "boolean" | "json";

export interface FieldSpec {
  type: FieldType;
  /** Reject create when missing/undefined in strict mode. */
  required?: boolean;
  /** Allow explicit null (default true). */
  nullable?: boolean;
  /** Allowed values (validated when present). */
  enum?: readonly string[];
  /** Applied when the field is undefined on create. */
  default?: unknown;
}

export type RelationKind = "belongsTo" | "hasMany" | "manyToMany";

export interface RelationSpec {
  kind: RelationKind;
  /** Local FK field holding the target id (for belongsTo). */
  key: string;
  /** Target model name. */
  target: string;
  /**
   * strict = the target must exist at write time (needs an `exists` resolver);
   * soft  = dangling tolerated, resolved at read (the resilient default).
   */
  integrity?: "strict" | "soft";
}

/**
 * Per-model write-contract. Most of this is auto-derivable from a DML model by an
 * adapter; here it is explicit so the core has zero Medusa coupling.
 */
export interface Contract {
  /** Model name (e.g. "person_property"). */
  model: string;
  /** Identity stage: id prefix for generated ids. */
  id?: { prefix?: string };
  /**
   * Natural/composite primary key fields. When set, records are keyed by the
   * joined values of these fields (e.g. workflow_execution keyed by
   * [workflow_id, transaction_id, run_id]) instead of a generated `id`, and
   * `upsert` matches on them. Defaults to ["id"] with a generated id.
   */
  primaryKey?: readonly string[];
  /** Shape stage: declared field specs (undeclared fields pass through untouched). */
  fields?: Record<string, FieldSpec>;
  /** Fields to maintain an equality secondary index for (fast filtered reads). */
  indexes?: readonly string[];
  /** Fields that must be unique across the model (natural keys, 1:1 endpoints). */
  unique?: readonly string[];
  /** Relationship specs (stages 3–4). */
  relations?: Record<string, RelationSpec>;
  /** Invariant stage: cross-field rules; return true or an error message. */
  invariants?: Array<(row: Record<string, any>) => true | string>;
  /** Idempotency: dedupe create on this natural key. */
  idempotencyKey?: (row: Record<string, any>) => string | undefined;
  /** strict = enforce required/enum/unique hard; lax = warn-and-allow shape, keep uniqueness. */
  mode?: "strict" | "lax";
  /**
   * Stamp Medusa-style `created_at`/`updated_at` (and a null `deleted_at`) on
   * write, the way every DML model does. Default true — set false only for a
   * model that manages its own timestamps. On create both default to now (a
   * caller-supplied value, e.g. a backfill preserving origin times, is kept); on
   * update `created_at` is preserved and `updated_at` is always bumped.
   */
  timestamps?: boolean;
}

/** Query operators supported by the resolver (mirrors the proven DAL). */
export type WhereCond =
  | unknown
  | {
      $in?: unknown[];
      $ne?: unknown;
      $gt?: unknown;
      $gte?: unknown;
      $lt?: unknown;
      $lte?: unknown;
    };
export type Where = Record<string, WhereCond>;
export interface ListConfig {
  /** undefined → default page size; null → no limit (Query passes null to mean "all"). */
  take?: number | null;
  skip?: number;
  order?: Record<string, string>;
}

/** Optional cross-model resolver for strict referential integrity. */
export interface RepositoryContext {
  /** Return whether a record of `model` with `id` exists. */
  exists?: (model: string, id: string) => Promise<boolean>;
}

/** The minimal Hyperbee surface the repository needs (structurally typed). */
export interface BeeLike {
  sub(name: string, opts?: any): BeeLike;
  put(key: string, value: any): Promise<void>;
  get(key: string): Promise<{ key: string; value: any } | null>;
  del(key: string): Promise<void>;
  createReadStream(range?: { gte?: string; lt?: string; gt?: string; lte?: string }): AsyncIterable<{
    key: string;
    value: any;
  }>;
}

/**
 * The internal-service surface Medusa's generated methods invoke on the injected
 * `${model}Service`. Satisfying this = the DAL swap.
 */
export interface ModelRepository {
  create(data: any): Promise<any>;
  retrieve(id: string): Promise<any>;
  list(filters?: Where, config?: ListConfig): Promise<any[]>;
  listAndCount(filters?: Where, config?: ListConfig): Promise<[any[], number]>;
  update(data: any): Promise<any>;
  upsert(data: any): Promise<any>;
  /** Accepts an id, ids, a filter object, or an array of partial-key/filter objects. */
  delete(selector: string | string[] | Where | Where[]): Promise<void>;
  softDelete(): Promise<[any[], Record<string, unknown>]>;
  restore(): Promise<[any[], Record<string, unknown>]>;
}

/** Error thrown by contract enforcement (mapped to MedusaError by the adapter). */
export class ContractError extends Error {
  constructor(
    public readonly type:
      | "invalid_data"
      | "not_found"
      | "not_unique"
      | "not_allowed",
    message: string
  ) {
    super(message);
    this.name = "ContractError";
  }
}
