/**
 * Proof: the package DAL can back Medusa's `workflow_execution` store (Seam B).
 *
 * It replays the EXACT calls the workflow engine's DistributedTransactionStorage
 * makes on the injected `workflowExecutionService_`
 * (node_modules/@medusajs/workflow-engine-inmemory/dist/utils/workflow-orchestrator-storage.js):
 *   - upsert([{ workflow_id, transaction_id, run_id, execution, context, state, retention_time }])
 *   - list({ workflow_id, transaction_id }, { order: { id: "desc" }, take: 1 })   (get)
 *   - delete([{ run_id }])                                                        (deleteFromDb)
 *   - delete({ retention_time: {$ne:null}, updated_at: {$lte: raw()}, state: {$in} })  (retention)
 *
 * Proves the append-log is a drop-in for the execution journal: composite PK,
 * upsert-in-place, partial-key delete, and the one Postgres-`raw()` retention
 * predicate degrading to a safe no-op (JS retention is a follow-up, not a
 * correctness gap).
 *
 * Run: pnpm --filter @jytextiles/mikrohyperbee exec tsx test/workflow-store.e2e.ts
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore
import Corestore from "corestore";
// @ts-ignore
import Hyperbee from "hyperbee";

import { defineContract, hyperbeeRepositoryFor } from "../src";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) (pass++, console.log(`  ✓ ${m}`));
  else (fail++, console.error(`  ✗ ${m}`));
};

// Mirrors @medusajs/workflow-engine-inmemory WorkflowExecution model.
const workflowExecution = defineContract("workflow_execution", {
  id: { prefix: "wf_exec" },
  primaryKey: ["workflow_id", "transaction_id", "run_id"],
  mode: "lax",
  fields: {
    workflow_id: { type: "string", required: true },
    transaction_id: { type: "string", required: true },
    run_id: { type: "string", required: true },
    execution: { type: "json", nullable: true },
    context: { type: "json", nullable: true },
    state: { type: "string" },
    retention_time: { type: "number", nullable: true },
  },
  indexes: ["workflow_id", "transaction_id", "run_id", "state"],
});

const STORE = join(tmpdir(), `wf-store-${process.pid}`);

// A fake Postgres raw() predicate — an opaque object, exactly what the retention
// sweep passes. The KV matcher must treat it as unevaluable (never match).
const raw = () => ({ __raw: "CURRENT_TIMESTAMP - INTERVAL ..." });

async function main() {
  if (existsSync(STORE)) rmSync(STORE, { recursive: true, force: true });
  const store = new Corestore(STORE);
  await store.ready();
  const bee = new Hyperbee(store.get({ name: "workflow_execution" }), {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  await bee.ready();

  const svc = hyperbeeRepositoryFor(workflowExecution, bee as any);

  // 1) engine checkpoints a running transaction (upsert)
  await svc.upsert([
    {
      workflow_id: "create-weaver",
      transaction_id: "tx_1",
      run_id: "run_1",
      execution: { flow: { state: "invoking", steps: { _root: {}, s1: { depth: 1 } } } },
      context: { data: { input: 1 }, errors: [] },
      state: "invoking",
      retention_time: null,
    },
  ]);

  // 2) engine loads it back (get → list by workflow+transaction)
  const loaded = await svc.list(
    { workflow_id: "create-weaver", transaction_id: "tx_1" },
    { order: { id: "desc" }, take: 1 }
  );
  ok(loaded.length === 1, "checkpoint persisted + loadable via list()");
  ok(loaded[0].state === "invoking", "loaded execution has state=invoking");
  ok(loaded[0].execution?.flow?.state === "invoking", "execution jsonb round-trips");

  // 3) engine advances the SAME transaction to done → upsert must update in place
  await svc.upsert([
    {
      workflow_id: "create-weaver",
      transaction_id: "tx_1",
      run_id: "run_1",
      execution: { flow: { state: "done" } },
      context: { data: { input: 1, output: 42 }, errors: [] },
      state: "done",
      retention_time: 3600,
    },
  ]);
  const [afterRows, afterCount] = await svc.listAndCount({ transaction_id: "tx_1" });
  ok(afterCount === 1, `upsert updated in place, no duplicate (count=${afterCount})`);
  ok(afterRows[0].state === "done", "state advanced invoking → done on same composite key");
  ok(afterRows[0].context?.data?.output === 42, "context jsonb updated");

  // 4) a second run of the same workflow → distinct record (different run_id)
  await svc.upsert([
    { workflow_id: "create-weaver", transaction_id: "tx_2", run_id: "run_2", state: "invoking" },
  ]);
  const [, total] = await svc.listAndCount({ workflow_id: "create-weaver" });
  ok(total === 2, `distinct run persisted separately (total=${total})`);

  // 5) engine deletes a finished, non-retained transaction (delete by partial key)
  await svc.delete([{ run_id: "run_2" }]);
  const [, afterDel] = await svc.listAndCount({ workflow_id: "create-weaver" });
  ok(afterDel === 1, `deleteFromDb({run_id}) removed exactly that run (remaining=${afterDel})`);

  // 6) retention sweep uses a Postgres raw() predicate → safe no-op over KV,
  //    must NOT delete the still-valid retained record.
  await svc.delete({
    retention_time: { $ne: null },
    updated_at: { $lte: raw() },
    state: { $in: ["done", "failed", "reverted"] },
  } as any);
  const [, afterSweep] = await svc.listAndCount({ workflow_id: "create-weaver" });
  ok(afterSweep === 1, "retention sweep with raw() predicate is a safe no-op (record intact)");

  rmSync(STORE, { recursive: true, force: true });
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST THREW:", e);
  process.exit(1);
});
