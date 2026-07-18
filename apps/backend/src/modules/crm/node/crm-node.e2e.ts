/**
 * Proxy-path proof: the REAL CrmService driven through the proxy repositories →
 * HTTP → the standalone CRM node → its Autobase writer → back. This is exactly the
 * prod Topology-A write path (`POST /admin/crm/*` → service → proxy → node), minus
 * the Medusa HTTP shell. No Postgres.
 *
 * Run: tsx apps/backend/src/modules/crm/node/crm-node.e2e.ts
 */
import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { MedusaError } from "@medusajs/framework/utils";

import { openCrmNode, createCrmNodeServer } from "./server";
import { createCrmProxyRepositories } from "../dal/crm-proxy";
import CrmServiceDefault from "../service";

const CrmService: any = (CrmServiceDefault as any)?.default ?? CrmServiceDefault;

let PASS = 0;
let FAIL = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) { PASS++; console.log(`  ✓ ${label}`); }
  else { FAIL++; console.error(`  ✗ ${label}`); }
};
async function throwsMedusa(fn: () => Promise<any>, type: string, label: string) {
  try {
    await fn();
    ok(`${label} (expected throw, none)`, false);
  } catch (e: any) {
    const got = e instanceof MedusaError ? e.type : e?.name;
    ok(`${label} (threw ${got})`, e instanceof MedusaError && got === type);
  }
}

const DIR = join(tmpdir(), `crm-node-e2e-${process.pid}`);

async function main() {
  rmSync(DIR, { recursive: true, force: true });

  const node = await openCrmNode(DIR);
  const server = createCrmNodeServer(node);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  console.log(`CRM node up on ${url} (base writable=${node.base.writable})\n`);

  // The loader would register exactly these as crmCompanyService, etc.
  const repos = createCrmProxyRepositories(url);
  const container: any = {
    resolve(name: string) { return this[name]; },
    crmCompanyService: repos.crmCompanyService,
    crmPersonService: repos.crmPersonService,
    crmOpportunityService: repos.crmOpportunityService,
    crmNoteService: repos.crmNoteService,
    crmTaskService: repos.crmTaskService,
  };
  const svc: any = new CrmService(container);

  // ── create → the write leaves Medusa, lands in the node's Autobase ────────────
  const co = await svc.createCrmCompanies({ name: "Bhujodi Weaves", industry: "textiles", region: "GUJARAT" });
  ok(`company created via proxy → node (id ${co.id})`, /^crmco_/.test(co.id));
  ok("node stamped timestamps", !!co.created_at && !!co.updated_at);

  await throwsMedusa(
    () => svc.createCrmCompanies({ name: "Bhujodi Weaves" }),
    MedusaError.Types.INVALID_DATA,
    "duplicate company name rejected across the wire (not_unique → INVALID_DATA)"
  );

  // ── read-back + filtered index read over HTTP ─────────────────────────────────
  const fetched = await svc.retrieveCrmCompany(co.id);
  ok("retrieve by id round-trips through the node", fetched.id === co.id && fetched.name === "Bhujodi Weaves");

  const person = await svc.createCrmPeople({
    first_name: "Champa", last_name: "Ben", email: "champa@bhujodi.in", company_id: co.id,
  });
  const [people, pCount] = await svc.listAndCountCrmPeople({ company_id: co.id }, { take: 20 });
  ok(`list people by company_id → 1 (got ${pCount})`, pCount === 1 && people[0].id === person.id);

  // ── update stage/field, then a reindexed filter read ──────────────────────────
  const opp = await svc.createCrmOpportunities({ title: "Wholesale AW26", amount: 500000, company_id: co.id, owner_person_id: person.id });
  ok("opportunity defaults applied by the node (stage/currency)", opp.stage === "prospecting" && opp.currency === "INR");
  const moved = await svc.updateCrmOpportunities({ id: opp.id, stage: "negotiation" });
  ok("update persisted through the node", moved.stage === "negotiation" && moved.created_at === opp.created_at);
  const [neg] = await svc.listAndCountCrmOpportunities({ stage: "negotiation" });
  ok("reindexed filter read (stage=negotiation) → 1 across the wire", neg.length === 1 && neg[0].id === opp.id);

  // ── not_found + delete + unique release ───────────────────────────────────────
  await throwsMedusa(
    () => svc.retrieveCrmCompany("crmco_missing"),
    MedusaError.Types.NOT_FOUND,
    "retrieve missing → NOT_FOUND propagated from the node"
  );
  await svc.deleteCrmPeople(person.id);
  ok("delete removed the person", (await svc.listAndCountCrmPeople({ company_id: co.id }))[1] === 0);
  const reused = await svc.createCrmPeople({ first_name: "New", last_name: "Owner", email: "champa@bhujodi.in" });
  ok("unique email freed on delete (reusable through the node)", !!reused.id);

  // ── cleanup ───────────────────────────────────────────────────────────────────
  await new Promise<void>((r) => server.close(() => r()));
  await node.close();
  rmSync(DIR, { recursive: true, force: true });

  console.log(
    `\n${FAIL === 0 ? "✅ PASS" : "❌ FAIL"} — ${PASS} passed, ${FAIL} failed — ` +
    `the real CrmService drives CRUD through the proxy → CRM node → Autobase.`
  );
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST THREW:", e);
  process.exit(1);
});
