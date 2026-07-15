/**
 * The staged write-contract (pure stages).
 *
 * Stages that don't need store access live here: Shape (types/required/enum/
 * defaults/coercion) and Invariants (cross-field rules). Identity, Uniqueness,
 * Referential and Commit need the store and live in the repository, but they are
 * driven by the same Contract so the whole pipeline reads as one thing.
 */
import { Contract, ContractError, FieldSpec } from "./types";

/** Ergonomic identity helper — validates the contract once and returns it. */
export function defineContract(model: string, spec: Omit<Contract, "model">): Contract {
  const contract: Contract = { model, mode: "lax", ...spec };
  // Cheap self-checks so a malformed contract fails loudly at load, not at write.
  for (const u of contract.unique ?? []) {
    if (contract.fields && !(u in contract.fields)) {
      // A unique key that isn't a declared field is allowed (it may be an
      // undeclared/open field), but index+unique on the same open field is fine.
    }
  }
  for (const [name, rel] of Object.entries(contract.relations ?? {})) {
    if (rel.kind === "belongsTo" && !rel.key) {
      throw new Error(`[mikrohyperbee] relation '${name}' (belongsTo) needs a 'key'`);
    }
  }
  return contract;
}

function coerce(value: unknown, spec: FieldSpec): unknown {
  if (value === undefined || value === null) return value;
  switch (spec.type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    case "string":
      return typeof value === "string" ? value : String(value);
    default:
      return value; // json passes through
  }
}

function typeOk(value: unknown, spec: FieldSpec): boolean {
  switch (spec.type) {
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "json":
      return true;
  }
}

/**
 * Stage 1 — Shape. Validates + coerces declared fields, applies defaults.
 * Undeclared fields pass through untouched (schema-flexibility). In strict mode
 * violations throw; in lax mode they are collected as warnings and allowed
 * (except a hard type mismatch on a present value, which always throws — that is
 * corruption, not flexibility).
 */
export function applyShape(
  contract: Contract,
  input: Record<string, any>
): { row: Record<string, any>; warnings: string[] } {
  const fields = contract.fields ?? {};
  const strict = contract.mode === "strict";
  const warnings: string[] = [];
  const row: Record<string, any> = { ...input };

  for (const [name, spec] of Object.entries(fields)) {
    let v = row[name];

    if (v === undefined && spec.default !== undefined) {
      v = typeof spec.default === "function" ? (spec.default as any)() : spec.default;
    }

    if (v === undefined) {
      if (spec.required) {
        const msg = `field '${name}' is required`;
        if (strict) throw new ContractError("invalid_data", msg);
        warnings.push(msg);
      }
      continue;
    }

    if (v === null) {
      if (spec.nullable === false) {
        const msg = `field '${name}' may not be null`;
        if (strict) throw new ContractError("invalid_data", msg);
        warnings.push(msg);
      }
      row[name] = v;
      continue;
    }

    v = coerce(v, spec);
    if (!typeOk(v, spec)) {
      // A present-but-wrong-type value is corruption regardless of mode.
      throw new ContractError(
        "invalid_data",
        `field '${name}' expected ${spec.type}, got ${typeof row[name]}`
      );
    }
    if (spec.enum && !spec.enum.includes(v as string)) {
      const msg = `field '${name}' must be one of [${spec.enum.join(", ")}], got '${v}'`;
      if (strict) throw new ContractError("invalid_data", msg);
      warnings.push(msg);
    }
    row[name] = v;
  }

  return { row, warnings };
}

/** Stage 5 — Invariants. Cross-field CHECK-like rules. */
export function checkInvariants(contract: Contract, row: Record<string, any>): void {
  for (const inv of contract.invariants ?? []) {
    const res = inv(row);
    if (res !== true) {
      throw new ContractError("invalid_data", `invariant failed: ${res}`);
    }
  }
}
