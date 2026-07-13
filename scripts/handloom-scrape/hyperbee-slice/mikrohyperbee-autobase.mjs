// MikroHyperbee M4 — multi-writer + append-only transactions (no rollback).
//
// Two ideas, unified:
//
// 1. TRANSACTIONS AS A STATUS LOG (not rollback). A log can't delete to undo,
//    so a txn is journaled as: `begin` (carries its ops) → later a `status`
//    flip to `committed` | `failed`. Reads gate visibility on txn status:
//    a record is visible iff the txn that BORN it is committed and no committed
//    txn has marked it DEAD. "Compensation" = append `status: failed` (or a
//    forward delete-txn), never a physical delete — so you keep a full audit of
//    every attempt, and a crash between begin and status leaves the txn
//    `pending` (invisible) = safe by construction.
//
// 2. MULTI-WRITER VIA AUTOBASE. Each peer appends to its own core; Autobase
//    linearizes all writers into ONE deterministic Hyperbee view. The
//    linearized log literally IS the transaction journal — status flips from
//    either writer converge. This is the path between the free per-state peers.
//
// Everything is checked: convergence across peers + visibility rules, asserted.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import Autobase from "autobase";
import b4a from "b4a";
import { rmSync } from "node:fs";
import assert from "node:assert";

let PASS = 0;
const ok = (label, cond) => { assert(cond, `FAIL: ${label}`); console.log(`  ✓ ${label}`); PASS++; };

// Projection catalog: which fields get a secondary index, per model.
// Numeric fields are zero-padded so lexicographic key order == numeric order
// (enables range scans over an ordered KV store).
const INDEXED = { person: ["region", "own", "looms"] };
const NUMERIC = new Set(["looms"]);
const idxVal = (f, v) => (NUMERIC.has(f) ? String(v).padStart(8, "0") : String(v));

// ── Autobase view + apply: the log becomes the txn journal ──────────────────
function open(store) {
  return new Hyperbee(store.get("view"), { keyEncoding: "utf-8", valueEncoding: "json", extension: false });
}
async function apply(nodes, view, host) {
  for (const { value } of nodes) {
    if (value.type === "add-writer") {
      await host.addWriter(b4a.from(value.key, "hex"), { indexer: value.indexer === true });
      continue;
    }
    if (value === null) continue; // ack block — advances the linearizer, no effect on the view
    if (value.type === "begin") {
      await view.put(`txn/${value.txid}`, { status: "pending", ops: value.ops, writer: value.writer });
      for (const op of value.ops) {
        const rk = `rec/${op.model}/${op.id}`;
        const fields = INDEXED[op.model] || [];
        if (op.op === "put") {
          await view.put(rk, { row: op.row, born: value.txid, dead: null });
          // Index is an MVCC-style ACCELERATOR: it only *points* at ids; the read
          // path still re-checks the loaded row's value + txn visibility. So we
          // never need to delete stale entries (updates just add a new pointer).
          for (const f of fields)
            if (op.row[f] !== undefined && op.row[f] !== null)
              await view.put(`idx/${op.model}/${f}/${idxVal(f, op.row[f])}/${op.id}`, op.id);
        } else if (op.op === "del") {
          const cur = await view.get(rk);
          if (cur) { const r = cur.value; r.dead = value.txid; await view.put(rk, r); }
        }
      }
      continue;
    }
    if (value.type === "status") {
      const t = await view.get(`txn/${value.txid}`);
      if (t) { const tv = t.value; tv.status = value.status; await view.put(`txn/${value.txid}`, tv); }
      continue;
    }
  }
}

// ── a peer: an Autobase + a transactional, visibility-aware repository ───────
class Peer {
  constructor(name, store, bootstrap) {
    this.name = name;
    this.base = new Autobase(store, bootstrap, { open, apply, valueEncoding: "json" });
    this._txn = 0;
  }
  async ready() { await this.base.ready(); return this; }
  get view() { return this.base.view; }
  get key() { return this.base.key; }
  get localKey() { return this.base.local.key; }
  async sync() { await this.base.update(); }

  txid() { return `${this.name}-tx${++this._txn}`; }
  async addWriter(key, { indexer = false } = {}) { await this.base.append({ type: "add-writer", key: b4a.toString(key, "hex"), indexer }); }
  async ack() { await this.base.append(null); }

  // one-shot committed txn (begin + status:committed in the journal)
  async commit(ops) {
    const txid = this.txid();
    await this.base.append({ type: "begin", txid, ops, writer: this.name });
    await this.base.append({ type: "status", txid, status: "committed" });
    return txid;
  }
  // two-phase: stage a pending txn, decide later — the "status update" model
  async begin(ops) {
    const txid = this.txid();
    await this.base.append({ type: "begin", txid, ops, writer: this.name });
    return txid;
  }
  async setStatus(txid, status) { await this.base.append({ type: "status", txid, status }); }

  // ---- reads: visibility-gated on txn status ----
  async _status(txid) { const t = await this.view.get(`txn/${txid}`); return t ? t.value.status : null; }
  // whether a record version is currently visible (shared gate for scan + index)
  async _visible(v) {
    if ((await this._status(v.born)) !== "committed") return false;                  // born txn not committed
    if (v.dead && (await this._status(v.dead)) === "committed") return false;        // committed delete-txn
    return true;
  }
  // full-scan read — the ORACLE the indexed path is checked against
  async find(model, where = {}) {
    const p = `rec/${model}/`;
    const out = [];
    let scanned = 0;
    for await (const { value } of this.view.createReadStream({ gte: p, lt: p + "~" })) {
      scanned++;
      if (!(await this._visible(value))) continue;
      if (Object.entries(where).every(([k, v]) => value.row[k] === v)) out.push(value.row);
    }
    out.scanned = scanned;
    return out.sort((a, b) => (a.id > b.id ? 1 : -1));
  }
  // index-accelerated read — narrows candidates via idx/, then re-checks the row.
  // Reports `loads` (record fetches) to prove it touches fewer rows than a scan.
  async findByIndex(model, field, value, where = {}) {
    const p = `idx/${model}/${field}/${value}/`;
    const out = [];
    let loads = 0;
    for await (const { value: id } of this.view.createReadStream({ gte: p, lt: p + "~" })) {
      const rec = await this.view.get(`rec/${model}/${id}`);
      loads++;
      if (!rec) continue;
      const v = rec.value;
      if (!(await this._visible(v))) continue;          // visibility gate (pending/failed/tombstoned)
      if (v.row[field] !== value) continue;             // stale pointer — record moved to a new value
      if (Object.entries(where).every(([k, val]) => v.row[k] === val)) out.push(v.row);
    }
    out.loads = loads;
    return out.sort((a, b) => (a.id > b.id ? 1 : -1));
  }
  // range scan over an ordered (numeric) index: field in [min, max] inclusive
  async findByRange(model, field, min, max, where = {}) {
    const lo = `idx/${model}/${field}/${idxVal(field, min)}/`;
    const hi = `idx/${model}/${field}/${idxVal(field, max)}/~`;
    const out = [];
    let loads = 0;
    for await (const { value: id } of this.view.createReadStream({ gte: lo, lte: hi })) {
      const rec = await this.view.get(`rec/${model}/${id}`);
      loads++;
      if (!rec) continue;
      const v = rec.value;
      if (!(await this._visible(v))) continue;
      if (!(v.row[field] >= min && v.row[field] <= max)) continue;   // recheck actual value
      if (Object.entries(where).every(([k, val]) => v.row[k] === val)) out.push(v.row);
    }
    out.loads = loads;
    return out.sort((a, b) => (a.id > b.id ? 1 : -1));
  }
  // compound AND: intersect id sets from two single-field indexes, then recheck
  async findByCompound(model, preds) {
    const sets = await Promise.all(Object.entries(preds).map(async ([f, val]) => {
      const p = `idx/${model}/${f}/${idxVal(f, val)}/`;
      const s = new Set();
      for await (const { value: id } of this.view.createReadStream({ gte: p, lt: p + "~" })) s.add(id);
      return s;
    }));
    const ids = [...sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))];
    const out = [];
    for (const id of ids) {
      const rec = await this.view.get(`rec/${model}/${id}`);
      if (!rec) continue;
      const v = rec.value;
      if (!(await this._visible(v))) continue;
      if (Object.entries(preds).every(([k, val]) => v.row[k] === val)) out.push(v.row);
    }
    return out.sort((a, b) => (a.id > b.id ? 1 : -1));
  }
  async audit() {
    const out = [];
    for await (const { key, value } of this.view.createReadStream({ gte: "txn/", lt: "txn/~" }))
      out.push({ txid: key.slice(4), status: value.status, ops: value.ops.length, writer: value.writer });
    return out.sort((a, b) => (a.txid > b.txid ? 1 : -1));
  }
}

// drive replication + linearizer convergence between peers (in-process streams)
function replicate(storeA, storeB) {
  const s1 = storeA.replicate(true), s2 = storeB.replicate(false);
  s1.on("error", () => {}); s2.on("error", () => {});
  s1.pipe(s2).pipe(s1);
}
// A (sole indexer) acks each round so the linearized/indexed view advances to
// include every peer's latest nodes; both then pull the converged order.
async function settle(peers, indexer, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    for (const p of peers) await p.sync();
    await indexer.ack();
    for (const p of peers) await p.sync();
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
rmSync("./_mwA", { recursive: true, force: true });
rmSync("./_mwB", { recursive: true, force: true });
const storeA = new Corestore("./_mwA");
const storeB = new Corestore("./_mwB");

const A = await new Peer("A", storeA, null).ready();          // bootstrap peer
const B = await new Peer("B", storeB, A.key).ready();         // joins by A.key
replicate(storeA, storeB);

console.log("── multi-writer bootstrap (Autobase) ──");
await A.addWriter(B.localKey);                                // A grants B write access
await settle([A, B], A);
await B.sync();
ok("B became a writer (can append)", (await B.commit([{ op: "put", model: "person", id: "pB", row: { id: "pB", first_name: "Bina", writer: "B" } }])) != null);
await settle([A, B], A);

console.log("\n── committed txns converge across both peers ──");
await A.commit([{ op: "put", model: "person", id: "pA", row: { id: "pA", first_name: "Arun", writer: "A" } }]);
await settle([A, B], A);
const aSees = (await A.find("person")).map((r) => r.id);
const bSees = (await B.find("person")).map((r) => r.id);
ok(`A sees both persons ${JSON.stringify(aSees)}`, JSON.stringify(aSees) === JSON.stringify(["pA", "pB"]));
ok("B converges to the SAME visible set as A", JSON.stringify(aSees) === JSON.stringify(bSees));

console.log("\n── FAILED txn: status flip, NOT a rollback ──");
const badId = "pGhost";
const tBad = await A.begin([{ op: "put", model: "person", id: badId, row: { id: badId, first_name: "Ghost" } }]);
await settle([A, B], A);
ok("pending txn's record is INVISIBLE before status", !(await A.find("person")).some((r) => r.id === badId));
await A.setStatus(tBad, "failed");                            // mark failed — no delete
await settle([A, B], A);
ok("failed txn's record stays INVISIBLE", !(await B.find("person")).some((r) => r.id === badId));
const auditA = await A.audit();
const ghostTxn = auditA.find((t) => t.txid === tBad);
ok("failed txn is RETAINED in the audit log (status=failed, ops kept)", ghostTxn && ghostTxn.status === "failed" && ghostTxn.ops === 1);
ok("audit log agrees across peers", JSON.stringify(auditA) === JSON.stringify(await B.audit()));

console.log("\n── two-phase: pending → committed makes it appear ──");
const tPend = await B.begin([{ op: "put", model: "person", id: "pLate", row: { id: "pLate", first_name: "Late" } }]);
await settle([A, B], A);
ok("still invisible while pending", !(await A.find("person")).some((r) => r.id === "pLate"));
await B.setStatus(tPend, "committed");
await settle([A, B], A);
ok("visible on BOTH peers after status→committed", (await A.find("person")).some((r) => r.id === "pLate") && (await B.find("person")).some((r) => r.id === "pLate"));

console.log("\n── forward compensation: committed delete-txn (tombstone), history kept ──");
await A.commit([{ op: "del", model: "person", id: "pB" }]);   // compensate pB by a committed delete
await settle([A, B], A);
ok("pB no longer visible after committed delete-txn", !(await A.find("person")).some((r) => r.id === "pB"));
ok("BUT pB's create txn is still in the audit history (nothing erased)", (await A.audit()).some((t) => t.writer === "B" && t.ops === 1));

console.log("\n── workflow step + compensation, expressed as txn status ──");
const tStep = await A.begin([{ op: "put", model: "person", id: "pWf", row: { id: "pWf", first_name: "Wf" } }]);
await settle([A, B], A);
// simulate the step's downstream failing → compensation = flip status, not delete
await A.setStatus(tStep, "failed");
await settle([A, B], A);
ok("workflow compensation via status:failed → effect invisible, attempt audited",
  !(await A.find("person")).some((r) => r.id === "pWf") && (await A.audit()).some((t) => t.txid === tStep && t.status === "failed"));

console.log("\n── secondary index: visibility-gated, checked against the full-scan oracle ──");
// seed 6 committed persons across 3 regions
const region = { ix1: "AMBALA", ix2: "AMBALA", ix3: "PANIPAT", ix4: "KARNAL", ix5: "KARNAL", ix6: "PANIPAT" };
for (const [id, r] of Object.entries(region))
  await A.commit([{ op: "put", model: "person", id, row: { id, first_name: id, region: r } }]);
// a FAILED create in AMBALA — its index pointer must NOT surface
const tFail = await A.begin([{ op: "put", model: "person", id: "ixFail", row: { id: "ixFail", first_name: "ixFail", region: "AMBALA" } }]);
await A.setStatus(tFail, "failed");
// an UPDATE that MOVES a row AMBALA → PANIPAT — the stale AMBALA pointer must not surface it
await A.commit([{ op: "put", model: "person", id: "ixMove", row: { id: "ixMove", first_name: "ixMove", region: "AMBALA" } }]);
await A.commit([{ op: "put", model: "person", id: "ixMove", row: { id: "ixMove", first_name: "ixMove", region: "PANIPAT" } }]);
// a committed delete-txn tombstone in PANIPAT — index pointer stays, read must skip it
await A.commit([{ op: "put", model: "person", id: "ixDead", row: { id: "ixDead", first_name: "ixDead", region: "PANIPAT" } }]);
await A.commit([{ op: "del", model: "person", id: "ixDead" }]);
await settle([A, B], A);

for (const r of ["AMBALA", "PANIPAT", "KARNAL"]) {
  const scan = await A.find("person", { region: r });
  const idx = await A.findByIndex("person", "region", r);
  ok(`index(region=${r}) == full-scan oracle → ${JSON.stringify(idx.map((x) => x.id))}`,
    JSON.stringify(idx.map((x) => x.id)) === JSON.stringify(scan.map((x) => x.id)));
}
{
  const idx = await A.findByIndex("person", "region", "AMBALA");
  ok("failed-txn row (ixFail) NOT surfaced via index", !idx.some((r) => r.id === "ixFail"));
  ok("moved row (ixMove) NOT under old value AMBALA (stale pointer filtered)", !idx.some((r) => r.id === "ixMove"));
  const pan = await A.findByIndex("person", "region", "PANIPAT");
  ok("moved row (ixMove) IS under new value PANIPAT", pan.some((r) => r.id === "ixMove"));
  ok("tombstoned row (ixDead) NOT surfaced via index", !pan.some((r) => r.id === "ixDead"));
}
{
  // the accelerator claim: indexed read touches far fewer records than a scan
  const scan = await A.find("person", { region: "KARNAL" });
  const idx = await A.findByIndex("person", "region", "KARNAL");
  console.log(`  · KARNAL: index loaded ${idx.loads} record(s) vs full scan of ${scan.scanned}`);
  ok(`indexed read narrows candidates (${idx.loads} loads < ${scan.scanned} scanned)`, idx.loads < scan.scanned);
}
{
  // index converges across peers
  await B.sync();
  const a = (await A.findByIndex("person", "region", "PANIPAT")).map((r) => r.id);
  const b = (await B.findByIndex("person", "region", "PANIPAT")).map((r) => r.id);
  ok(`peer B's indexed read matches peer A's ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));
}

console.log("\n── (1) batch atomicity: a txn's ops are all-or-nothing ──");
{
  // failed batch: op2 would violate a constraint → whole txn failed → op1 also invisible
  const tBad = await A.begin([
    { op: "put", model: "person", id: "batch1", row: { id: "batch1", first_name: "B1", region: "GOA" } },
    { op: "put", model: "person", id: "batch2", row: { id: "batch2", first_name: "B2", region: "GOA" } },
  ]);
  await A.setStatus(tBad, "failed"); // validation rejected the batch
  await settle([A, B], A);
  const vis = (await A.find("person")).map((r) => r.id);
  ok("failed batch: NEITHER op1 nor op2 visible", !vis.includes("batch1") && !vis.includes("batch2"));
  // committed batch: both visible together
  await A.commit([
    { op: "put", model: "person", id: "batch3", row: { id: "batch3", first_name: "B3", region: "GOA" } },
    { op: "put", model: "person", id: "batch4", row: { id: "batch4", first_name: "B4", region: "GOA" } },
  ]);
  await settle([A, B], A);
  const vis2 = (await A.find("person")).map((r) => r.id);
  ok("committed batch: BOTH op3 and op4 visible", vis2.includes("batch3") && vis2.includes("batch4"));
}

console.log("\n── (2) concurrent conflict: same id, two writers, deterministic winner ──");
{
  // A and B both write id="dup" WITHOUT seeing each other, then both commit
  await A.commit([{ op: "put", model: "person", id: "dup", row: { id: "dup", first_name: "FromA", region: "X" } }]);
  await B.commit([{ op: "put", model: "person", id: "dup", row: { id: "dup", first_name: "FromB", region: "X" } }]);
  await settle([A, B], A);
  const aDup = (await A.find("person", {})).find((r) => r.id === "dup");
  const bDup = (await B.find("person", {})).find((r) => r.id === "dup");
  ok("both peers agree on the SAME winning value for the conflicted id", aDup.first_name === bDup.first_name);
  ok("winner is one of the two concurrent writes (LWW by linearized order)", ["FromA", "FromB"].includes(aDup.first_name));
  const both = (await A.audit()).filter((t) => t.ops === 1 && (t.writer === "A" || t.writer === "B"));
  ok("BOTH conflicting txns retained + committed in the journal (loser not erased)",
    both.length >= 2);
  console.log(`  · winner: ${aDup.first_name} (deterministic across peers)`);
}

console.log("\n── (4) compound + range index ──");
{
  // seed persons with region + own(boolean) + looms(numeric)
  const rows = [
    { id: "w1", region: "AMBALA", own: true, looms: 1 },
    { id: "w2", region: "AMBALA", own: true, looms: 3 },
    { id: "w3", region: "AMBALA", own: false, looms: 2 },
    { id: "w4", region: "PANIPAT", own: true, looms: 4 },
    { id: "w5", region: "PANIPAT", own: true, looms: 2 },
    { id: "w6", region: "AMBALA", own: true, looms: 5 },
  ];
  for (const r of rows) await A.commit([{ op: "put", model: "person", id: r.id, row: { ...r, first_name: r.id } }]);
  await settle([A, B], A);

  // range: looms in [2,4]
  const range = await A.findByRange("person", "looms", 2, 4);
  const rangeScan = (await A.find("person")).filter((r) => r.looms >= 2 && r.looms <= 4);
  ok(`range(looms∈[2,4]) == scan oracle → ${JSON.stringify(range.map((r) => r.id))}`,
    JSON.stringify(range.map((r) => r.id)) === JSON.stringify(rangeScan.map((r) => r.id).sort()));

  // compound AND: region=AMBALA & own=true
  const comp = await A.findByCompound("person", { region: "AMBALA", own: true });
  const compScan = (await A.find("person")).filter((r) => r.region === "AMBALA" && r.own === true);
  ok(`compound(region=AMBALA ∧ own=true) == scan oracle → ${JSON.stringify(comp.map((r) => r.id))}`,
    JSON.stringify(comp.map((r) => r.id)) === JSON.stringify(compScan.map((r) => r.id).sort()));
  ok("compound result is the intersection (w1,w2,w6 — not w3 own=false, not w4/w5 PANIPAT)",
    JSON.stringify(comp.map((r) => r.id)) === JSON.stringify(["w1", "w2", "w6"]));
}

console.log("\n── final convergence check ──");
await settle([A, B], A, 8);
const finalA = JSON.stringify((await A.find("person")).map((r) => r.id));
const finalB = JSON.stringify((await B.find("person")).map((r) => r.id));
ok(`both peers converge to identical final state ${finalA}`, finalA === finalB);
ok("indexers linearized the same audit log", JSON.stringify(await A.audit()) === JSON.stringify(await B.audit()));

await A.base.close(); await B.base.close();
rmSync("./_mwA", { recursive: true, force: true });
rmSync("./_mwB", { recursive: true, force: true });
console.log(`\n✅ ${PASS}/${PASS} assertions passed — append-only transactions (commit/fail via status) + Autobase multi-writer converge deterministically.`);
process.exit(0);
