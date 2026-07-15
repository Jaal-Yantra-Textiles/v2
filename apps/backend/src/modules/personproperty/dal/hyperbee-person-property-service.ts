/**
 * MikroHyperbee DAL for `person_property` — now a thin binding over the extracted
 * `@jytextiles/mikrohyperbee` package. The generic HyperbeeBaseRepository + the
 * staged write-contract live in the package; this file just declares the
 * person_property contract and hands back a repository.
 *
 * The package core imports zero @medusajs and no native deps (it takes a ready
 * Hyperbee), so importing it here is production-safe even with the flag off — the
 * loader only opens a store + builds the repo when PERSON_PROPERTY_HYPERBEE=true.
 *
 * Contract mirrors ../models/person_property.ts. The person link is a Medusa
 * module-link (no FK column), so it is not a belongsTo here; census_id is the
 * natural key we uniquify + dedupe (idempotent re-import) on. Provenance domain →
 * lax mode (schema-on-read flexibility, keep uniqueness).
 */
import { MedusaError } from "@medusajs/framework/utils";

import {
  ContractError,
  defineContract,
  hyperbeeRepositoryFor,
  type BeeLike,
  type ModelRepository,
} from "@jytextiles/mikrohyperbee";

export const personPropertyContract = defineContract("person_property", {
  id: { prefix: "pp" },
  mode: "lax",
  fields: {
    profile_type: { type: "string", default: "weaver" },
    census_id: { type: "string", nullable: true },
    relation_to_head: { type: "string", nullable: true },
    gender: { type: "string", nullable: true },
    social_group: { type: "string", nullable: true },
    religion: { type: "string", nullable: true },
    region_state: { type: "string", nullable: true },
    district: { type: "string", nullable: true },
    own_looms: { type: "boolean", nullable: true },
    total_looms_owned: { type: "number", nullable: true },
    natural_dye_used: { type: "boolean", nullable: true },
    sells_local_market: { type: "boolean", nullable: true },
    sells_master_weaver: { type: "boolean", nullable: true },
    sells_cooperative: { type: "boolean", nullable: true },
    sells_ecommerce: { type: "boolean", nullable: true },
    support_requirements: { type: "json", nullable: true },
    metadata: { type: "json", nullable: true },
  },
  // The fields weavers are segmented by (equality secondary index).
  indexes: ["profile_type", "social_group", "district", "region_state", "gender", "own_looms"],
  // census_id is the natural identity — unique + idempotent on re-import.
  unique: ["census_id"],
  idempotencyKey: (r) => (r.census_id ? `census:${r.census_id}` : undefined),
});

// ── Medusa adapter ──────────────────────────────────────────────────────────
// The package core is Medusa-free and throws its own ContractError; Medusa's
// routes + error middleware expect MedusaError (for 404/400 mapping). This thin
// boundary translates the two. It wraps only the repository methods so the
// underlying identity (constructor.name = HyperbeeBaseRepository) is preserved.
const ERROR_MAP: Record<ContractError["type"], string> = {
  not_found: MedusaError.Types.NOT_FOUND,
  invalid_data: MedusaError.Types.INVALID_DATA,
  not_unique: MedusaError.Types.INVALID_DATA,
  not_allowed: MedusaError.Types.NOT_ALLOWED,
};
const WRAPPED = new Set([
  "create", "retrieve", "list", "listAndCount", "update", "upsert", "delete", "softDelete", "restore",
]);

function toMedusaRepository(repo: ModelRepository): ModelRepository {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function" && WRAPPED.has(prop as string)) {
        return async (...args: any[]) => {
          try {
            return await (value as (...a: any[]) => any).apply(target, args);
          } catch (e) {
            if (e instanceof ContractError) {
              throw new MedusaError(
                ERROR_MAP[e.type] ?? MedusaError.Types.UNEXPECTED_STATE,
                e.message
              );
            }
            throw e;
          }
        };
      }
      return value;
    },
  }) as ModelRepository;
}

/** Build the Hyperbee-backed internal service Medusa's generated methods call. */
export function createPersonPropertyRepository(bee: BeeLike) {
  return toMedusaRepository(hyperbeeRepositoryFor(personPropertyContract, bee));
}
