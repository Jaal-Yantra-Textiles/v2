/**
 * REAL end-to-end proof: the module's actual PersonPropertyService
 * (class extends MedusaService({ PersonProperty })) driven over the module's
 * ported Hyperbee DAL (HyperbeePersonPropertyService) — no Postgres, no MikroORM.
 *
 * This re-homes the MikroHyperbee spike proof into the module so it lives beside
 * the code it validates. It exercises the SERVICE seam (generated methods →
 * injected internal `personPropertyService`), which is exactly what the flag-gated
 * loader (loaders/hyperbee-dal.ts) rewires at boot.
 *
 * Run:  node_modules/.bin/tsx apps/backend/src/modules/personproperty/__tests__/hyperbee-dal.e2e.ts
 */
import assert from "node:assert";
import { rmSync } from "node:fs";

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { MedusaError } from "@medusajs/framework/utils";

import { HyperbeePersonPropertyService } from "../dal/hyperbee-person-property-service";
import PersonPropertyServiceDefault from "../service";

// CJS-interop can double-wrap the default export depending on the loader.
const PersonPropertyService: any =
  (PersonPropertyServiceDefault as any)?.default ?? PersonPropertyServiceDefault;

let PASS = 0;
const ok = (label: string, cond: boolean) => {
  assert(cond, `FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
  PASS++;
};

const DIR = "./_pp_hb_e2e";

async function main() {
  rmSync(DIR, { recursive: true, force: true });
  const store = new Corestore(DIR);
  const bee = new Hyperbee(store.get({ name: "person_property" }), {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  const internal = new HyperbeePersonPropertyService(bee);

  const container: any = {
    baseRepository: {
      serialize: async (d: any) => JSON.parse(JSON.stringify(d)),
      getFreshManager: () => internal,
      getActiveManager: () => internal,
      transaction: async (task: any) => task(internal),
    },
    personPropertyService: internal,
    eventBusModuleService: { emit: async () => {} },
    messageAggregator: {
      saveRawMessageData() {},
      getMessages() {
        return [];
      },
      clearMessages() {},
    },
  };

  const svc: any = new PersonPropertyService(container);
  console.log("Instantiated the REAL PersonPropertyService over the module's Hyperbee DAL.\n");

  const one = await svc.createPersonProperties({
    profile_type: "weaver",
    census_id: "2904500",
    social_group: "Schedule Caste",
    district: "AMBALA",
    own_looms: true,
    total_looms_owned: 2,
  });
  ok(`created single -> id ${one.id}`, !!one.id && one.social_group === "Schedule Caste");

  const many = await svc.createPersonProperties([
    { profile_type: "weaver", census_id: "2904501", social_group: "Scheduled Tribe", district: "AMBALA", own_looms: false, total_looms_owned: 0 },
    { profile_type: "weaver", census_id: "2904502", social_group: "Other Backward Caste", district: "PANIPAT", own_looms: true, total_looms_owned: 3 },
    { profile_type: "weaver", census_id: "2904503", social_group: "Scheduled Tribe", district: "AMBALA", own_looms: true, total_looms_owned: 4 },
  ]);
  ok("created batch of 3", Array.isArray(many) && many.length === 3);

  const st = await svc.listPersonProperties({ social_group: "Scheduled Tribe" });
  ok(`filter social_group='Scheduled Tribe' -> ${st.length}`, st.length === 2 && st.every((r: any) => r.social_group === "Scheduled Tribe"));

  const ambala = await svc.listPersonProperties({ district: "AMBALA", own_looms: true });
  ok(`compound filter district=AMBALA & own_looms=true -> ${ambala.length}`, ambala.length === 2);

  const heavy = await svc.listPersonProperties({ total_looms_owned: { $gte: 2 } });
  ok(`operator filter total_looms_owned>=2 -> ${heavy.length}`, heavy.length === 3);

  const [page, count] = await svc.listAndCountPersonProperties(
    { profile_type: "weaver" },
    { take: 2, skip: 0, order: { census_id: "ASC" } }
  );
  ok("count=4 weavers, page of 2", count === 4 && page.length === 2);

  const got = await svc.retrievePersonProperty(one.id);
  ok("retrieve by id", got.census_id === "2904500");
  let threw = false;
  try {
    await svc.retrievePersonProperty("pp_999999");
  } catch (e: any) {
    threw = e instanceof MedusaError;
  }
  ok("retrieve missing -> MedusaError NOT_FOUND", threw);

  await svc.updatePersonProperties({ id: many[1].id, district: "KARNAL" });
  ok("update moved out of PANIPAT", (await svc.listPersonProperties({ district: "PANIPAT" })).length === 0);
  ok("update reindexed into KARNAL", (await svc.listPersonProperties({ district: "KARNAL" })).length === 1);

  await svc.deletePersonProperties(many[0].id);
  ok("delete removed the row", (await svc.listAndCountPersonProperties({ profile_type: "weaver" }))[1] === 3);

  await store.close();
  rmSync(DIR, { recursive: true, force: true });
  console.log(`\n✅ ${PASS}/${PASS} assertions — the REAL PersonPropertyService runs end-to-end over the module's Hyperbee DAL.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
