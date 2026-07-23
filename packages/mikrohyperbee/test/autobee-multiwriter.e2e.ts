/**
 * Multi-writer proof: two independent Autobase writers, replicated in-process,
 * both driving the SAME CRM contracts through the AutobeeRepository. Proves:
 *   1. cross-writer merge — each writer's records appear on the other,
 *   2. deterministic uniqueness resolution across writers (email clash),
 *   3. last-writer-wins by updated_at (a stale write is dropped on both views).
 *
 * No Medusa, no Postgres, no network. Run:
 *   pnpm --filter @jytextiles/mikrohyperbee exec tsx test/autobee-multiwriter.e2e.ts
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore - devDependencies, resolved at test time
import Corestore from "corestore";
// @ts-ignore
import Hyperbee from "hyperbee";
// @ts-ignore
import Autobase from "autobase";

import {
  defineContract,
  autobeeRepositoryFor,
  makeApply,
  authorizeWriter,
  ContractError,
} from "../src";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
};

// ── the CRM-shaped contracts (company + person, with unique constraints) ────────
const company = defineContract("crm_company", {
  id: { prefix: "crmco" },
  mode: "strict",
  fields: {
    name: { type: "string", required: true },
    industry: { type: "string", nullable: true },
  },
  indexes: ["industry"],
  unique: ["name"],
});
const person = defineContract("crm_person", {
  id: { prefix: "crmp" },
  mode: "strict",
  fields: {
    first_name: { type: "string", required: true },
    last_name: { type: "string", required: true },
    email: { type: "string", nullable: true },
    company_id: { type: "string", nullable: true },
  },
  indexes: ["email", "company_id"],
  unique: ["email"],
});
const contracts = { crm_company: company, crm_person: person };

const ROOT = join(tmpdir(), `autobee-mw-${process.pid}`);

function makeBase(dir: string, bootstrap: Buffer | null) {
  const store = new Corestore(dir);
  const base = new Autobase(store, bootstrap, {
    valueEncoding: "json",
    open(viewStore: any) {
      return new Hyperbee(viewStore.get("view"), {
        keyEncoding: "utf-8",
        valueEncoding: "binary",
      });
    },
    apply: makeApply(contracts),
  });
  return { store, base };
}

function pipe(a: any, b: any) {
  const s1 = a.replicate(true);
  const s2 = b.replicate(false);
  s1.pipe(s2).pipe(s1);
  return () => { try { s1.destroy(); s2.destroy(); } catch {} };
}

/** Drive the linearizer on both bases until the view stops changing. */
async function settle(...bases: any[]) {
  for (let i = 0; i < 8; i++) {
    for (const b of bases) await b.update();
    await new Promise((r) => setImmediate(r));
  }
}

async function main() {
  rmSync(ROOT, { recursive: true, force: true });

  const A = makeBase(join(ROOT, "a"), null);
  await A.base.ready();
  const B = makeBase(join(ROOT, "b"), A.base.key);
  await B.base.ready();

  const stop = pipe(A.store, B.store);

  // A (the bootstrap/indexer) authorizes B as a writer.
  await authorizeWriter(A.base, B.base.local.key);
  await settle(A.base, B.base);
  ok(A.base.writable === true, "writer A is writable (bootstrap)");
  ok(B.base.writable === true, "writer B authorized + writable after addWriter");

  const personA = autobeeRepositoryFor(person, A.base);
  const companyA = autobeeRepositoryFor(company, A.base);
  const personB = autobeeRepositoryFor(person, B.base);
  const companyB = autobeeRepositoryFor(company, B.base);

  // ── 1. cross-writer merge ─────────────────────────────────────────────────────
  const acme = await companyA.create({ name: "Acme", industry: "tech" });
  const sam = await personB.create({ first_name: "Sam", last_name: "Rao", email: "sam@x.io" });
  ok(/^crmco_/.test(acme.id) && acme.id !== "crmco_000001", `A minted a writer-scoped id (${acme.id})`);
  ok(/^crmp_/.test(sam.id), `B minted a writer-scoped id (${sam.id})`);
  await settle(A.base, B.base);

  const acmeSeenByB = await companyB.list({ name: "Acme" });
  const samSeenByA = await personA.list({ email: "sam@x.io" });
  ok(acmeSeenByB.length === 1 && acmeSeenByB[0].id === acme.id, "A's company is visible on writer B");
  ok(samSeenByA.length === 1 && samSeenByA[0].id === sam.id, "B's person is visible on writer A");

  // filtered index read across writers
  const techByB = await companyB.list({ industry: "tech" });
  ok(techByB.length === 1 && techByB[0].id === acme.id, "secondary index (industry) resolves across writers");

  // ── 2. deterministic uniqueness resolution across writers ─────────────────────
  const dupA = await personA.create({ first_name: "Dup", last_name: "A", email: "dup@x.io" });
  await settle(A.base, B.base);
  let bRejected = false;
  try {
    await personB.create({ first_name: "Dup", last_name: "B", email: "dup@x.io" });
  } catch (e: any) {
    bRejected = e instanceof ContractError && e.type === "not_unique";
  }
  ok(bRejected, "writer B's duplicate email is rejected (loser sees the winner's reservation)");
  await settle(A.base, B.base);
  const dupOnA = await personA.list({ email: "dup@x.io" });
  const dupOnB = await personB.list({ email: "dup@x.io" });
  ok(dupOnA.length === 1 && dupOnB.length === 1, "exactly one 'dup@x.io' record on BOTH views");
  ok(
    dupOnA[0].id === dupA.id && dupOnB[0].id === dupA.id,
    "both writers agree on the SAME uniqueness winner (deterministic)"
  );

  // ── 3. last-writer-wins by updated_at ─────────────────────────────────────────
  const beta = await companyA.create({ name: "Beta", industry: "old" });
  await settle(A.base, B.base);
  // B updates Beta → newer updated_at; both should converge to B's value.
  const betaB = await companyB.update({ id: beta.id, industry: "new-from-B" });
  await settle(A.base, B.base);
  const betaSeenByA = await companyA.retrieve(beta.id);
  ok(betaSeenByA.industry === "new-from-B", "cross-writer update converges (B's value on A)");

  // Now craft a STALE write from A: same id, an OLDER updated_at → must be dropped.
  const staleTs = new Date(Date.parse(betaB.updated_at) - 60_000).toISOString();
  await A.base.append({
    t: "put",
    model: "crm_company",
    row: { ...betaSeenByA, industry: "stale-from-A", updated_at: staleTs },
  });
  await settle(A.base, B.base);
  const betaFinalA = await companyA.retrieve(beta.id);
  const betaFinalB = await companyB.retrieve(beta.id);
  ok(betaFinalA.industry === "new-from-B", "stale write (older updated_at) dropped on A — LWW");
  ok(betaFinalB.industry === "new-from-B", "stale write dropped on B too — deterministic LWW");

  // ── cleanup ───────────────────────────────────────────────────────────────────
  stop();
  await A.store.close?.();
  await B.store.close?.();
  rmSync(ROOT, { recursive: true, force: true });

  console.log(
    `\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed — ` +
    `two Autobase writers ran the CRM contracts multi-writer (merge + uniqueness + LWW).`
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST THREW:", e);
  process.exit(1);
});
