// MikroHyperbee test (3): crash-recovery / durability.
// Commit one txn, leave a second txn PENDING (begin, no status), then CLOSE the
// base + store (simulating a crash), reopen from the same on-disk dir, and
// assert: committed state survived, the pending txn is still pending (invisible),
// and the log resumes — flipping it to committed after recovery makes it appear.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import Autobase from "autobase";
import { rmSync } from "node:fs";
import assert from "node:assert";

let PASS = 0;
const ok = (l, c) => { assert(c, `FAIL: ${l}`); console.log(`  ✓ ${l}`); PASS++; };

const open = (store) => new Hyperbee(store.get("view"), { keyEncoding: "utf-8", valueEncoding: "json", extension: false });
async function apply(nodes, view) {
  for (const { value } of nodes) {
    if (value === null) continue;
    if (value.type === "begin") {
      await view.put(`txn/${value.txid}`, { status: "pending", ops: value.ops });
      for (const op of value.ops)
        if (op.op === "put") await view.put(`rec/${op.model}/${op.id}`, { row: op.row, born: value.txid, dead: null });
      continue;
    }
    if (value.type === "status") {
      const t = await view.get(`txn/${value.txid}`);
      if (t) { const tv = t.value; tv.status = value.status; await view.put(`txn/${value.txid}`, tv); }
    }
  }
}
const status = async (view, txid) => { const t = await view.get(`txn/${txid}`); return t ? t.value.status : null; };
async function visible(view, model) {
  const out = [], p = `rec/${model}/`;
  for await (const { value } of view.createReadStream({ gte: p, lt: p + "~" }))
    if ((await status(view, value.born)) === "committed" && !(value.dead && (await status(view, value.dead)) === "committed"))
      out.push(value.row.id);
  return out.sort();
}

const DIR = "./_dur";
rmSync(DIR, { recursive: true, force: true });

// ── session 1: write, then "crash" mid-transaction ──────────────────────────
let store = new Corestore(DIR);
let base = new Autobase(store, null, { open, apply, valueEncoding: "json" });
await base.ready();
const bootKey = base.key;

// committed txn
await base.append({ type: "begin", txid: "t1", ops: [{ op: "put", model: "person", id: "survivor", row: { id: "survivor" } }] });
await base.append({ type: "status", txid: "t1", status: "committed" });
// pending txn — the "in-flight" work interrupted by the crash
await base.append({ type: "begin", txid: "t2", ops: [{ op: "put", model: "person", id: "inflight", row: { id: "inflight" } }] });
await base.update();

ok("before crash: committed 'survivor' visible", (await visible(base.view, "person")).includes("survivor"));
ok("before crash: pending 'inflight' invisible", !(await visible(base.view, "person")).includes("inflight"));

// hard close — flush cores to disk and drop all in-memory state
await base.close();
await store.close();
console.log("  · closed base + store (simulated crash)\n");

// ── session 2: reopen the SAME dir and recover ──────────────────────────────
store = new Corestore(DIR);
base = new Autobase(store, bootKey, { open, apply, valueEncoding: "json" });
await base.ready();
await base.update();

const recovered = await visible(base.view, "person");
ok("after reopen: committed 'survivor' SURVIVED", recovered.includes("survivor"));
ok("after reopen: pending 'inflight' still INVISIBLE (safe — no torn write)", !recovered.includes("inflight"));
ok("after reopen: pending txn still in journal as 'pending'", (await status(base.view, "t2")) === "pending");

// the log resumes — resolve the previously-pending txn post-recovery
await base.append({ type: "status", txid: "t2", status: "committed" });
await base.update();
ok("log resumes: flipping recovered txn → committed makes 'inflight' appear", (await visible(base.view, "person")).includes("inflight"));

await base.close();
await store.close();
rmSync(DIR, { recursive: true, force: true });
console.log(`\n✅ ${PASS}/${PASS} assertions passed — durable across close/reopen; committed survives, pending stays safe.`);
process.exit(0);
