/**
 * STEP 0 — live boot verification of the MikroHyperbee DAL seam.
 *
 * Proves the one thing the M6 spike could NOT: that the module's flag-gated
 * `hyperbee-dal` loader override actually BEATS Medusa's auto-registered
 * internal service when the module is loaded through Medusa's REAL loader
 * pipeline (connectionLoader -> containerLoader -> custom loaders).
 *
 * It boots ONLY this module via MedusaModule.bootstrap (no app, no HTTP), and
 * injects a stub `manager` in options so the MikroORM connectionLoader returns
 * before touching Postgres (mikro-orm-connection-loader.js:21-25). The Hyperbee
 * loader then overrides personPropertyService + baseRepository; if the override
 * wins, the generated createPersonProperties/listAndCountPersonProperties run
 * over Hyperbee and the internal service is HyperbeePersonPropertyService.
 *
 * Run:  cd apps/backend && \
 *   PERSON_PROPERTY_HYPERBEE=true \
 *   PERSON_PROPERTY_HYPERBEE_STORE=./.pp-boot-verify-store \
 *   ../../node_modules/.bin/tsx src/modules/personproperty/__tests__/hyperbee-boot-verify.ts
 */
import { MedusaModule } from "@medusajs/modules-sdk";
import { existsSync, rmSync } from "fs";
import { resolve } from "path";

import personPropertyModule, { PERSON_PROPERTY_MODULE } from "../index";

// loadResources re-imports the service from this path (dynamicImport(defaultPath).service),
// so it must point at the module's own index, not @medusajs/framework.
const MODULE_PATH = resolve(process.cwd(), "src/modules/personproperty/index.ts");

const STORE = process.env.PERSON_PROPERTY_HYPERBEE_STORE || "./.pp-boot-verify-store";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  // clean slate
  if (existsSync(STORE)) rmSync(STORE, { recursive: true, force: true });

  if (process.env.PERSON_PROPERTY_HYPERBEE !== "true") {
    console.error("PERSON_PROPERTY_HYPERBEE must be 'true' for this verify");
    process.exit(2);
  }

  console.log("• Booting person_property via MedusaModule.bootstrap (flag ON, stub manager, no PG)…");

  const loaded = await MedusaModule.bootstrap({
    moduleKey: PERSON_PROPERTY_MODULE,
    defaultPath: MODULE_PATH,
    moduleExports: personPropertyModule as any,
    declaration: {
      scope: "internal" as any,
      // stub manager -> connectionLoader skips the real PG connection
      options: { manager: {} as any } as any,
    } as any,
  });

  const service: any = loaded[PERSON_PROPERTY_MODULE];
  assert(!!service, "module service resolved from bootstrap");

  // 1) the override won: the internal service is the Hyperbee one.
  // __container__ is the awilix cradle (property access == resolve).
  const internal = service.__container__?.personPropertyService;
  assert(!!internal, "internal personPropertyService is registered");
  assert(
    internal?.constructor?.name === "HyperbeePersonPropertyService",
    `internal service is HyperbeePersonPropertyService (got '${internal?.constructor?.name}') — LOADER OVERRIDE WON`
  );

  // 2) live round-trip through the REAL generated methods
  const created = await service.createPersonProperties({
    person_id: "pers_boot_verify_1",
    district: "AMBALA",
    state: "HARYANA",
    total_looms_owned: 3,
  });
  const rec = Array.isArray(created) ? created[0] : created;
  assert(!!rec?.id, `createPersonProperties returned a record with id (${rec?.id})`);
  assert(rec?.district === "AMBALA", "created record round-trips district=AMBALA");

  const [rows, count] = await service.listAndCountPersonProperties(
    { district: "AMBALA" },
    { take: 20, skip: 0 }
  );
  assert(count >= 1, `listAndCountPersonProperties count>=1 (got ${count})`);
  assert(
    rows.some((r: any) => r.id === rec.id),
    "listed rows include the created record"
  );

  // 3) it actually persisted to the Hyperbee store on disk (not PG)
  assert(existsSync(STORE), `Hyperbee store dir written to disk at ${STORE}`);

  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  await MedusaModule.clearInstances?.();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("BOOT VERIFY THREW:", e);
  process.exit(1);
});
