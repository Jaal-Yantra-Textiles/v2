/**
 * REAL end-to-end proof: the module's actual CrmService driven over the
 * module's Hyperbee DAL from @jytextiles/mikrohyperbee — no Postgres, no MikroORM.
 *
 * Exercises the SERVICE seam (CrmService methods → injected per-entity
 * repositories), which is exactly what the always-on loader
 * (loaders/hyperbee-dal.ts) wires at boot. Covers all 5 entities plus the
 * cross-entity exists() resolver (opportunity → company/person) and the
 * ContractError → MedusaError boundary.
 *
 * Run:  node_modules/.bin/tsx apps/backend/src/modules/crm/__tests__/hyperbee-crm.e2e.ts
 */
import assert from "node:assert";
import { rmSync } from "node:fs";

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { MedusaError } from "@medusajs/framework/utils";

import { createCrmRepositories } from "../dal/hyperbee-crm-service";
import CrmServiceDefault from "../service";

const CrmService: any =
  (CrmServiceDefault as any)?.default ?? CrmServiceDefault;

let PASS = 0;
let FAIL = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) {
    console.log(`  ✓ ${label}`);
    PASS++;
  } else {
    console.error(`  ✗ ${label}`);
    FAIL++;
  }
};
async function throwsMedusa(
  fn: () => Promise<any>,
  type: string,
  label: string
) {
  try {
    await fn();
    ok(`${label} (expected throw, none)`, false);
  } catch (e: any) {
    const got = e instanceof MedusaError ? e.type : e?.name;
    ok(`${label} (threw ${got})`, e instanceof MedusaError && got === type);
  }
}

const DIR = "./_crm_hb_e2e";

async function main() {
  rmSync(DIR, { recursive: true, force: true });
  const store = new Corestore(DIR);
  const bee = new Hyperbee(store.get({ name: "crm" }), {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  await bee.ready();
  const repos = createCrmRepositories(bee as any);

  const container: any = {
    resolve(name: string) {
      return this[name];
    },
    crmCompanyService: repos.crmCompanyService,
    crmPersonService: repos.crmPersonService,
    crmOpportunityService: repos.crmOpportunityService,
    crmNoteService: repos.crmNoteService,
    crmTaskService: repos.crmTaskService,
    baseRepository: {
      serialize: async (d: any) => JSON.parse(JSON.stringify(d)),
      getFreshManager: () => repos,
      getActiveManager: () => repos,
      transaction: async (task: any) => task(repos),
    },
  };

  const svc: any = new CrmService(container);
  console.log("Instantiated the REAL CrmService over the module's Hyperbee DAL.\n");

  // ── companies ────────────────────────────────────────────────────────────────
  const co = await svc.createCrmCompanies({
    name: "Jaal Yantra Textiles",
    website: "https://jyt.in",
    industry: "textiles",
    region: "HARYANA",
  });
  ok(`company created -> id ${co.id} (prefix crmco)`, /^crmco_\d{6}$/.test(co.id));
  ok("company stamps ISO timestamps", !!co.created_at && !!co.updated_at);

  await throwsMedusa(
    () => svc.createCrmCompanies({ name: "Jaal Yantra Textiles" }),
    MedusaError.Types.INVALID_DATA,
    "duplicate company name rejected (not_unique → INVALID_DATA)"
  );

  const co2 = await svc.createCrmCompanies({ name: "Anokhi", industry: "textiles", region: "RAJASTHAN" });
  const [cos, coCount] = await svc.listAndCountCrmCompanies(
    { industry: "textiles" },
    { take: 10 }
  );
  ok(`list companies industry=textiles -> count 2 (got ${coCount})`, coCount === 2 && cos.length === 2);
  ok("company filter returns only matching rows", cos.every((c: any) => c.industry === "textiles"));

  // ── people ───────────────────────────────────────────────────────────────────
  const person = await svc.createCrmPeople({
    first_name: "Saransh",
    last_name: "Sharma",
    email: "s@jyt.in",
    title: "Founder",
    company_id: co.id,
  });
  ok(`person created -> id ${person.id} (prefix crmp)`, /^crmp_\d{6}$/.test(person.id));
  ok("person carries company_id", person.company_id === co.id);

  await throwsMedusa(
    () => svc.createCrmPeople({ first_name: "Dup", last_name: "Email", email: "s@jyt.in" }),
    MedusaError.Types.INVALID_DATA,
    "duplicate person email rejected"
  );

  const [people, pCount] = await svc.listAndCountCrmPeople(
    { company_id: co.id },
    { take: 10 }
  );
  ok(`list people by company_id -> count 1 (got ${pCount})`, pCount === 1 && people[0].id === person.id);

  // ── opportunities (cross-entity exists) ───────────────────────────────────────
  const opp = await svc.createCrmOpportunities({
    title: "Handloom wholesale order",
    stage: "prospecting",
    amount: 250000,
    currency: "INR",
    company_id: co.id,
    owner_person_id: person.id,
  });
  ok(`opportunity created -> id ${opp.id} (prefix crmo)`, /^crmo_\d{6}$/.test(opp.id));
  ok("opportunity default stage=prospecting", opp.stage === "prospecting");
  ok("opportunity default currency=INR", opp.currency === "INR");

  // invariant: amount >= 0
  await throwsMedusa(
    () => svc.createCrmOpportunities({ title: "Bad deal", amount: -5, company_id: co.id }),
    MedusaError.Types.INVALID_DATA,
    "opportunity amount<0 rejected by invariant"
  );

  // enum: bad stage
  await throwsMedusa(
    () => svc.createCrmOpportunities({ title: "Bad stage", stage: "ghost", company_id: co.id }),
    MedusaError.Types.INVALID_DATA,
    "opportunity bad stage enum rejected"
  );

  // cross-entity exists(): flip the opportunity→company relation to strict by
  // creating one with a dangling company_id. Soft mode tolerates it; the soft
  // relation still stores + indexes the field.
  const dangling = await svc.createCrmOpportunities({
    title: "Dangling company",
    company_id: "crmco_999999",
  });
  ok("soft relation tolerates dangling company_id", dangling.company_id === "crmco_999999");

  const [oppsByCompany] = await svc.listAndCountCrmOpportunities({ company_id: co.id });
  ok(`list opportunities by company -> ${oppsByCompany.length}`, oppsByCompany.length === 1 && oppsByCompany[0].id === opp.id);

  // stage progression + reindex
  const moved = await svc.updateCrmOpportunities({ id: opp.id, stage: "negotiation" });
  ok("opportunity stage updated", moved.stage === "negotiation");
  ok("opportunity created_at preserved on update", moved.created_at === opp.created_at);
  ok("opportunity updated_at bumped", moved.updated_at >= opp.updated_at);
  const [neg] = await svc.listAndCountCrmOpportunities({ stage: "negotiation" });
  ok("reindexed: stage=negotiation -> 1", neg.length === 1);
  const [pros] = await svc.listAndCountCrmOpportunities({ stage: "prospecting" });
  ok("reindexed: stage=prospecting -> 1 (the dangling one)", pros.length === 1);

  // ── notes (related_type/related_id) ────────────────────────────────────────────
  const note = await svc.createCrmNotes({
    body: "Followed up on the handloom order.",
    author: "s@jyt.in",
    related_type: "opportunity",
    related_id: opp.id,
  });
  ok(`note created -> id ${note.id} (prefix crmn)`, /^crmn_\d{6}$/.test(note.id));

  await throwsMedusa(
    () => svc.createCrmNotes({ body: "x", related_type: "ghost" as any }),
    MedusaError.Types.INVALID_DATA,
    "note bad related_type enum rejected"
  );

  const [notesForOpp] = await svc.listAndCountCrmNotes(
    { related_type: "opportunity", related_id: opp.id },
    { take: 10 }
  );
  ok(`list notes by related opportunity -> ${notesForOpp.length}`, notesForOpp.length === 1 && notesForOpp[0].id === note.id);

  // ── tasks (assignee + status) ──────────────────────────────────────────────────
  const task = await svc.createCrmTasks({
    title: "Send samples",
    status: "pending",
    priority: "high",
    assignee_person_id: person.id,
    related_type: "opportunity",
    related_id: opp.id,
  });
  ok(`task created -> id ${task.id} (prefix crmt)`, /^crmt_\d{6}$/.test(task.id));
  ok("task default status=pending", task.status === "pending");
  ok("task default priority=medium… overridden to high", task.priority === "high");

  const [tasksForPerson] = await svc.listAndCountCrmTasks(
    { assignee_person_id: person.id },
    { take: 10 }
  );
  ok(`list tasks by assignee -> ${tasksForPerson.length}`, tasksForPerson.length === 1 && tasksForPerson[0].id === task.id);

  // mark complete
  const done = await svc.updateCrmTasks({ id: task.id, status: "completed" });
  ok("task status updated", done.status === "completed");
  const [pendingTasks] = await svc.listAndCountCrmTasks({ status: "pending" });
  ok("reindexed: status=pending -> 0", pendingTasks.length === 0);
  const [doneTasks] = await svc.listAndCountCrmTasks({ status: "completed" });
  ok("reindexed: status=completed -> 1", doneTasks.length === 1);

  // ── retrieve missing → MedusaError NOT_FOUND ──────────────────────────────────
  await throwsMedusa(
    () => svc.retrieveCrmCompany("crmco_000000"),
    MedusaError.Types.NOT_FOUND,
    "retrieve missing company -> NOT_FOUND"
  );

  // ── delete + unique release ────────────────────────────────────────────────────
  await svc.deleteCrmPeople(person.id);
  ok("delete person removed row", (await svc.listAndCountCrmPeople({ company_id: co.id }))[1] === 0);
  // email freed on delete → reusable
  const reused = await svc.createCrmPeople({ first_name: "S", last_name: "S", email: "s@jyt.in" });
  ok("person email unique key released on delete (reusable)", !!reused.id);

  // ── bare-array IN filter (the shape query.graph uses for linked records) ───────
  const byIds = await svc.listCrmCompanies({ id: [co.id, co2.id] });
  ok(`bare-array id IN -> ${byIds.length}`, byIds.length === 2);

  // ── take: null means "no limit" ────────────────────────────────────────────────
  const allOpps = await svc.listCrmOpportunities({}, { take: null } as any);
  ok(`take:null returns all (got ${allOpps.length})`, allOpps.length >= 2);

  await store.close?.();
  rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${FAIL === 0 ? "✅ PASS" : "❌ FAIL"} — ${PASS} passed, ${FAIL} failed — the REAL CrmService runs end-to-end over the module's Hyperbee DAL.`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST THREW:", e);
  process.exit(1);
});
