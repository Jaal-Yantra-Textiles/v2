/**
 * Step 3 — durable workflow execution over Hyperbee (Seam B, full engine class).
 *
 * Boots Medusa's REAL InMemoryDistributedTransactionStorage (the actual code the
 * workflow engine uses to persist `store:true` transactions) with our
 * @jytextiles/mikrohyperbee package repository injected as the
 * `workflowExecutionService`. Then drives real save()/get() checkpoints and
 * proves the two things durable execution needs:
 *   (1) a checkpoint written by one instance SURVIVES a simulated process death
 *       (a fresh repo + storage over the SAME on-disk store reads it back), and
 *   (2) retention cleanup works in JS (the one Postgres raw() predicate the
 *       engine uses is reimplemented here — clearExpiredWorkflowExecutions).
 *
 * No Postgres. Run:
 *   cd apps/backend && ../../node_modules/.bin/tsx \
 *     src/modules/personproperty/__tests__/workflow-engine-hyperbee.script.ts
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore
import Corestore from "corestore";
// @ts-ignore
import Hyperbee from "hyperbee";
// @ts-ignore - deep import of the engine's real storage class (dist JS)
import { InMemoryDistributedTransactionStorage } from "@medusajs/workflow-engine-inmemory/dist/utils/workflow-orchestrator-storage";
import { TransactionState } from "@medusajs/utils";

import { defineContract, hyperbeeRepositoryFor, type ModelRepository } from "@jytextiles/mikrohyperbee";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) (pass++, console.log(`  ✓ ${m}`));
  else (fail++, console.error(`  ✗ ${m}`));
};

const STORE = join(tmpdir(), `wf-engine-hb-${process.pid}`);
const noopLogger = { info() {}, error() {}, warn() {}, debug() {} };

// The workflow_execution model (mirrors @medusajs/workflow-engine-inmemory).
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
    updated_at: { type: "number", nullable: true },
  },
  indexes: ["workflow_id", "transaction_id", "run_id", "state"],
});

function openRepo() {
  const store = new Corestore(STORE);
  const bee = new Hyperbee(store.get({ name: "workflow_execution" }), {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  return { store, repo: hyperbeeRepositoryFor(workflowExecution, bee as any) };
}

// A realistic transaction checkpoint (the shape DistributedTransaction hands to save()).
function checkpoint(state: any, extra: Record<string, any> = {}) {
  return {
    flow: {
      modelId: "create-weaver",
      transactionId: "tx_1",
      runId: "run_1",
      state,
      startedAt: 1,
      steps: { _root: { id: "_root", depth: 0, definition: {}, invoke: {}, compensate: {} } },
      definition: {},
      metadata: {},
      ...extra,
    },
    context: { input: 7 },
    errors: [],
  };
}

// JS reimplementation of the engine's clearExpiredExecutions (which uses a
// Postgres raw() predicate). This is what a Hyperbee-backed storage would run.
async function clearExpiredWorkflowExecutions(
  repo: ModelRepository,
  nowMs: number
): Promise<number> {
  const finished = new Set([
    TransactionState.DONE,
    TransactionState.FAILED,
    TransactionState.REVERTED,
  ]);
  const all = await repo.list({}, { take: 100000 });
  const expired = all.filter(
    (r: any) =>
      r.retention_time != null &&
      // If a row can't be aged (no updated_at), never delete it — conservative by
      // design. NOTE: engine-persisted rows lack updated_at today; production
      // retention needs the package to stamp updated_at on write (follow-up).
      r.updated_at != null &&
      finished.has(r.state) &&
      Number(r.updated_at) + r.retention_time * 1000 <= nowMs
  );
  for (const r of expired) {
    await repo.delete([{ run_id: r.run_id, transaction_id: r.transaction_id, workflow_id: r.workflow_id }]);
  }
  return expired.length;
}

async function main() {
  if (existsSync(STORE)) rmSync(STORE, { recursive: true, force: true });

  const KEY = "dtx:create-weaver:tx_1"; // storage key: <prefix>:<workflowId>:<transactionId>

  // ── "process A": engine persists an IN-PROGRESS checkpoint, then closes ──
  {
    const { store, repo } = openRepo();
    const storage: any = new InMemoryDistributedTransactionStorage({
      // proof harness: the Hyperbee repo + noop logger stand in for the
      // MedusaInternalService/Logger the engine expects — cast past the
      // structural gap (this file runs via tsx, not the app).
      workflowExecutionService: repo,
      logger: noopLogger,
    } as any);
    // NOT_STARTED is a persisted, resumable state (get() deliberately refuses to
    // return DONE/failed/reverted — a finished txn is never resumed).
    await storage.save(KEY, checkpoint(TransactionState.NOT_STARTED), 0, {});
    const loaded = await storage.get(KEY);
    ok(!!loaded, "engine save() → get() round-trips an in-progress checkpoint over Hyperbee");
    ok((await repo.list({ transaction_id: "tx_1" })).length === 1, "checkpoint row persisted to Hyperbee");
    await store.close(); // ← the process boundary
  }

  // ── SIMULATED CRASH → "process B": fresh repo + storage over the SAME store ──
  {
    const { store, repo } = openRepo();
    const storage: any = new InMemoryDistributedTransactionStorage({
      // proof harness: the Hyperbee repo + noop logger stand in for the
      // MedusaInternalService/Logger the engine expects — cast past the
      // structural gap (this file runs via tsx, not the app).
      workflowExecutionService: repo,
      logger: noopLogger,
    } as any);
    const resumed = await storage.get(KEY);
    ok(!!resumed, "checkpoint SURVIVES process death — a fresh engine instance reads it from Hyperbee");
    ok(resumed?.flow?.state === TransactionState.NOT_STARTED, "resumed flow has the persisted state");
    ok(resumed?.context?.input === 7, "resumed checkpoint restores the transaction context");

    // advance to DONE with retention → engine saveToDb persists in place
    await storage.save(KEY, checkpoint(TransactionState.DONE), 0, { retentionTime: 3600 });
    const rows = await repo.list({ transaction_id: "tx_1" });
    ok(rows.length === 1, `completed txn updated in place, no dup (got ${rows.length})`);
    ok(rows[0].retention_time === 3600, "retention_time persisted on completion");
    ok(rows[0].execution?.state === TransactionState.DONE, "execution jsonb advanced to DONE");
    await store.close();
  }

  // ── completion WITHOUT retention → engine deleteFromDb removes the row ──
  {
    const { store, repo } = openRepo();
    const storage: any = new InMemoryDistributedTransactionStorage({
      // proof harness: the Hyperbee repo + noop logger stand in for the
      // MedusaInternalService/Logger the engine expects — cast past the
      // structural gap (this file runs via tsx, not the app).
      workflowExecutionService: repo,
      logger: noopLogger,
    } as any);
    // a second transaction that finishes with no retention
    const K2 = "dtx:create-weaver:tx_2";
    await storage.save(K2, checkpoint(TransactionState.NOT_STARTED, { transactionId: "tx_2", runId: "run_2" }), 0, {});
    await storage.save(K2, checkpoint(TransactionState.DONE, { transactionId: "tx_2", runId: "run_2" }), 0, {});
    ok((await repo.list({ transaction_id: "tx_2" })).length === 0, "deleteFromDb removed the finished, non-retained txn");
    await store.close();
  }

  // ── JS retention (replaces the engine's Postgres raw() predicate) ──
  {
    const { store, repo } = openRepo();

    // one already-expired retained row, one still-valid, one no-retention
    const now = 1_000_000_000_000;
    await repo.upsert([
      { workflow_id: "w", transaction_id: "old", run_id: "r_old", state: TransactionState.DONE, retention_time: 60, updated_at: now - 120_000 },
      { workflow_id: "w", transaction_id: "fresh", run_id: "r_fresh", state: TransactionState.DONE, retention_time: 3600, updated_at: now - 1_000 },
      { workflow_id: "w", transaction_id: "keep", run_id: "r_keep", state: TransactionState.DONE, retention_time: null, updated_at: now - 999_999 },
    ]);

    const cleared = await clearExpiredWorkflowExecutions(repo, now);
    ok(cleared === 1, `retention swept exactly the expired row (cleared=${cleared})`);
    const remaining = await repo.list({ workflow_id: "w" });
    const ids = remaining.map((r: any) => r.transaction_id).sort();
    ok(
      !ids.includes("old") && ids.includes("fresh") && ids.includes("keep"),
      "expired removed; unexpired + non-retained kept"
    );
    await store.close();
  }

  rmSync(STORE, { recursive: true, force: true });
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SCRIPT THREW:", e);
  process.exit(1);
});
