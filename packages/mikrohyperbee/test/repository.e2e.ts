/**
 * Standalone proof: the contract-driven HyperbeeBaseRepository over a REAL
 * Hyperbee, no Medusa, no Postgres. Run: pnpm --filter @jytextiles/mikrohyperbee test
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore - resolved from devDependencies at test time
import Corestore from "corestore";
// @ts-ignore
import Hyperbee from "hyperbee";

import { defineContract, hyperbeeRepositoryFor, ContractError } from "../src";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}
async function throws(fn: () => Promise<any>, type: string, msg: string) {
  try {
    await fn();
    fail++;
    console.error(`  ✗ ${msg} (expected throw, none)`);
  } catch (e: any) {
    const t = e instanceof ContractError ? e.type : e?.name;
    ok(t === type, `${msg} (threw ${t})`);
  }
}

const STORE = join(tmpdir(), `mikrohyperbee-test-${process.pid}`);

// A provenance-domain contract: weaver properties, 1:1 with person, soft link.
const weaver = defineContract("person_property", {
  id: { prefix: "pp" },
  mode: "strict",
  fields: {
    profile_type: { type: "string", default: "weaver", enum: ["weaver", "artisan"] },
    person_id: { type: "string", required: true },
    census_id: { type: "string", nullable: true },
    district: { type: "string", nullable: true },
    region_state: { type: "string", nullable: true },
    total_looms_owned: { type: "number", nullable: true },
    own_looms: { type: "boolean", nullable: true },
  },
  indexes: ["district", "region_state", "profile_type"],
  unique: ["person_id", "census_id"],
  relations: {
    person: { kind: "belongsTo", key: "person_id", target: "person", integrity: "soft" },
  },
  invariants: [(r) => (r.total_looms_owned == null || r.total_looms_owned >= 0) || "looms must be >= 0"],
  idempotencyKey: (r) => (r.census_id ? `census:${r.census_id}` : undefined),
});

async function main() {
  if (existsSync(STORE)) rmSync(STORE, { recursive: true, force: true });
  const store = new Corestore(STORE);
  await store.ready();
  const bee = new Hyperbee(store.get({ name: "person_property" }), {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  await bee.ready();

  const repo = hyperbeeRepositoryFor(weaver, bee as any);

  // ── Shape + Identity ──
  const a = await repo.create({ person_id: "pers_1", district: "AMBALA", region_state: "HARYANA", total_looms_owned: "3" });
  ok(/^pp_\d{6}$/.test(a.id), `id generated with prefix (${a.id})`);
  ok(a.profile_type === "weaver", "default applied (profile_type=weaver)");
  ok(a.total_looms_owned === 3, "number coerced from string '3' -> 3");

  await throws(() => repo.create({ district: "X" }), "invalid_data", "required person_id enforced");
  await throws(
    () => repo.create({ person_id: "pers_x", profile_type: "spy" }),
    "invalid_data",
    "enum enforced (profile_type)"
  );
  await throws(
    () => repo.create({ person_id: "pers_y", total_looms_owned: -1 }),
    "invalid_data",
    "invariant enforced (looms >= 0)"
  );

  // ── Uniqueness ──
  await throws(
    () => repo.create({ person_id: "pers_1" }),
    "not_unique",
    "unique person_id collision rejected"
  );

  // ── Idempotency ──
  const c1 = await repo.create({ person_id: "pers_2", census_id: "100", district: "AMBALA" });
  const c2 = await repo.create({ person_id: "pers_2b", census_id: "100", district: "AMBALA" });
  ok(c1.id === c2.id, "idempotent on census_id — re-create returns same record");

  // ── Indexed query + listAndCount ──
  await repo.create({ person_id: "pers_3", district: "AMBALA", region_state: "HARYANA" });
  await repo.create({ person_id: "pers_4", district: "PANIPAT", region_state: "HARYANA" });
  const [rows, count] = await repo.listAndCount({ district: "AMBALA" }, { take: 10 });
  ok(count === 3, `indexed filter district=AMBALA -> 3 (got ${count})`);
  ok(rows.every((r) => r.district === "AMBALA"), "all returned rows match filter");

  // operator filter (non-indexed path)
  const gte = await repo.list({ total_looms_owned: { $gte: 3 } });
  ok(gte.length === 1 && gte[0].person_id === "pers_1", "$gte operator filter works");

  // ── Update reindex ──
  const upd = await repo.update({ id: a.id, district: "PANIPAT" });
  ok(upd.district === "PANIPAT", "update applied");
  const [, ambCount] = await repo.listAndCount({ district: "AMBALA" });
  ok(ambCount === 2, `old index entry removed on update (AMBALA now 2, got ${ambCount})`);

  // ── Delete ──
  await repo.delete(a.id);
  await throws(() => repo.retrieve(a.id), "not_found", "retrieve after delete throws not_found");
  // unique released on delete -> person_id reusable
  const reuse = await repo.create({ person_id: "pers_1" });
  ok(!!reuse.id, "unique key released on delete (person_id reusable)");

  // ── Strict referential without resolver fails closed ──
  const strictRel = defineContract("thing", {
    id: { prefix: "th" },
    fields: { owner_id: { type: "string", required: true } },
    relations: { owner: { kind: "belongsTo", key: "owner_id", target: "person", integrity: "strict" } },
  });
  const bee2 = new Hyperbee(store.get({ name: "thing" }), { keyEncoding: "utf-8", valueEncoding: "binary" });
  await bee2.ready();
  const strictRepo = hyperbeeRepositoryFor(strictRel, bee2 as any); // no exists() ctx
  await throws(
    () => strictRepo.create({ owner_id: "pers_1" }),
    "not_allowed",
    "strict relation without exists() resolver fails closed"
  );
  // with a resolver
  const strictRepo2 = hyperbeeRepositoryFor(strictRel, bee2 as any, {
    exists: async (_m, id) => id === "pers_1",
  });
  const good = await strictRepo2.create({ owner_id: "pers_1" });
  ok(!!good.id, "strict relation passes when target exists");
  await throws(
    () => strictRepo2.create({ owner_id: "ghost" }),
    "not_found",
    "strict relation rejects dangling target"
  );

  rmSync(STORE, { recursive: true, force: true });
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST THREW:", e);
  process.exit(1);
});
