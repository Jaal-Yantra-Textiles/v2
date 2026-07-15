/**
 * Small proof: the REAL Medusa `PersonPropertyService` (MedusaService({PersonProperty}))
 * generated methods run over the `@jytextiles/mikrohyperbee` package DAL — no
 * Postgres, no full Medusa boot. This is step 2 in miniature: swap the in-module
 * DAL class for the extracted package repository and confirm the generated
 * create/list/listAndCount/retrieve/update methods still round-trip.
 *
 * Run:  cd apps/backend && \
 *   ../../node_modules/.bin/tsx src/modules/personproperty/__tests__/package-dal.script.ts
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore resolved from apps/backend node_modules
import Corestore from "corestore";
// @ts-ignore
import Hyperbee from "hyperbee";

// Import the extracted package by source (workspace dep wiring comes with the
// real step-2 module rewire; a relative import keeps this script self-contained).
import { defineContract, hyperbeeRepositoryFor } from "../../../../../../packages/mikrohyperbee/src";

import PersonPropertyServiceImport from "../service";

// backend service default export can be CJS-interop double-wrapped.
const PersonPropertyService: any =
  (PersonPropertyServiceImport as any)?.default ?? PersonPropertyServiceImport;

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) (pass++, console.log(`  ✓ ${m}`));
  else (fail++, console.error(`  ✗ ${m}`));
};

// Contract mirrors src/modules/personproperty/models/person_property.ts. The
// person link is a Medusa module-link (no FK column), so it is not modelled as a
// belongsTo here — census_id is the natural key we dedupe/uniquify on.
const personPropertyContract = defineContract("person_property", {
  id: { prefix: "pp" },
  mode: "lax",
  fields: {
    profile_type: { type: "string", default: "weaver" },
    census_id: { type: "string", nullable: true },
    gender: { type: "string", nullable: true },
    social_group: { type: "string", nullable: true },
    region_state: { type: "string", nullable: true },
    district: { type: "string", nullable: true },
    own_looms: { type: "boolean", nullable: true },
    total_looms_owned: { type: "number", nullable: true },
  },
  indexes: ["profile_type", "social_group", "district", "region_state", "gender", "own_looms"],
  unique: ["census_id"],
  idempotencyKey: (r) => (r.census_id ? `census:${r.census_id}` : undefined),
});

const STORE = join(tmpdir(), `pp-package-dal-${process.pid}`);

async function main() {
  if (existsSync(STORE)) rmSync(STORE, { recursive: true, force: true });
  const store = new Corestore(STORE);
  await store.ready();
  const bee = new Hyperbee(store.get({ name: "person_property" }), {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  await bee.ready();

  // The package repository IS the internal per-model service.
  const repo = hyperbeeRepositoryFor(personPropertyContract, bee as any);

  // baseRepository stub: serialize + the manager/transaction seam the generated
  // service reaches through @InjectManager/@InjectTransactionManager.
  const baseRepository = {
    serialize: async (d: any) => JSON.parse(JSON.stringify(d)),
    getFreshManager: () => repo,
    getActiveManager: () => repo,
    transaction: async (task: (m: any) => any) => task(repo),
  };

  // Construct the REAL generated service with our container.
  const container = { personPropertyService: repo, baseRepository } as any;
  const service = new PersonPropertyService(container);

  // ── generated methods over the package DAL ──
  const created = await service.createPersonProperties({
    census_id: "1001",
    profile_type: "weaver",
    district: "AMBALA",
    region_state: "HARYANA",
    total_looms_owned: 3,
  });
  const rec = Array.isArray(created) ? created[0] : created;
  ok(/^pp_\d{6}$/.test(rec?.id), `createPersonProperties -> id (${rec?.id})`);
  ok(rec?.profile_type === "weaver", "record round-trips profile_type");

  // batch create
  await service.createPersonProperties([
    { census_id: "1002", district: "AMBALA", region_state: "HARYANA" },
    { census_id: "1003", district: "PANIPAT", region_state: "HARYANA" },
  ]);

  // idempotency through the generated method
  const dup = await service.createPersonProperties({ census_id: "1001", district: "AMBALA" });
  const dupRec = Array.isArray(dup) ? dup[0] : dup;
  ok(dupRec?.id === rec.id, "generated create is idempotent on census_id");

  // retrieve
  const got = await service.retrievePersonProperty(rec.id);
  ok(got?.id === rec.id, "retrievePersonProperty works");

  // listAndCount with indexed filter
  const [rows, count] = await service.listAndCountPersonProperties(
    { district: "AMBALA" },
    { take: 10 }
  );
  ok(count === 2, `listAndCount district=AMBALA -> 2 (got ${count})`);
  ok(rows.every((r: any) => r.district === "AMBALA"), "all listed rows match filter");

  // update + reindex
  const upd = await service.updatePersonProperties({ id: rec.id, district: "PANIPAT" });
  const updRec = Array.isArray(upd) ? upd[0] : upd;
  ok(updRec?.district === "PANIPAT", "updatePersonProperties applied");
  const [, amb] = await service.listAndCountPersonProperties({ district: "AMBALA" });
  ok(amb === 1, `index updated on change (AMBALA now 1, got ${amb})`);

  rmSync(STORE, { recursive: true, force: true });
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SCRIPT THREW:", e);
  process.exit(1);
});
