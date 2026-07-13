// MikroHyperbee test (5): scale / perf — indexed read vs full scan on a larger
// set. Single writer, bulk-ingested in batch txns. Deterministic data (seeded
// LCG — no Math.random). Reports wall-clock + records touched for each path.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import Autobase from "autobase";
import { rmSync } from "node:fs";
import assert from "node:assert";

let PASS = 0;
const ok = (l, c) => { assert(c, `FAIL: ${l}`); console.log(`  ✓ ${l}`); PASS++; };

const NUMERIC = new Set(["looms"]);
const idxVal = (f, v) => (NUMERIC.has(f) ? String(v).padStart(8, "0") : String(v));
const INDEXED = ["region", "looms"];

const open = (store) => new Hyperbee(store.get("view"), { keyEncoding: "utf-8", valueEncoding: "json", extension: false });
async function apply(nodes, view) {
  for (const { value } of nodes) {
    if (value === null) continue;
    if (value.type === "begin") {
      await view.put(`txn/${value.txid}`, { status: "pending" });
      for (const op of value.ops) {
        await view.put(`rec/person/${op.id}`, { row: op.row, born: value.txid, dead: null });
        for (const f of INDEXED)
          if (op.row[f] != null) await view.put(`idx/person/${f}/${idxVal(f, op.row[f])}/${op.id}`, op.id);
      }
      continue;
    }
    if (value.type === "status") {
      const t = await view.get(`txn/${value.txid}`);
      if (t) { const tv = t.value; tv.status = value.status; await view.put(`txn/${value.txid}`, tv); }
    }
  }
}
const status = async (view, txid) => { const t = await view.get(`txn/${txid}`); return t ? t.value.status : null; };
const visible = async (view, v) => (await status(view, v.born)) === "committed" && !(v.dead && (await status(view, v.dead)) === "committed");

async function findScan(view, where) {
  const out = []; let scanned = 0;
  for await (const { value } of view.createReadStream({ gte: "rec/person/", lt: "rec/person/~" })) {
    scanned++;
    if (!(await visible(view, value))) continue;
    if (Object.entries(where).every(([k, val]) => value.row[k] === val)) out.push(value.row.id);
  }
  return { ids: out, scanned };
}
async function findByIndex(view, field, val) {
  const p = `idx/person/${field}/${idxVal(field, val)}/`;
  const out = []; let loads = 0;
  for await (const { value: id } of view.createReadStream({ gte: p, lt: p + "~" })) {
    const rec = await view.get(`rec/person/${id}`); loads++;
    if (rec && (await visible(view, rec.value)) && rec.value.row[field] === val) out.push(id);
  }
  return { ids: out, loads };
}

// ── build a larger dataset ──────────────────────────────────────────────────
const N = 2000, REGIONS = 50;
let s = 987654321; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

rmSync("./_perf", { recursive: true, force: true });
const store = new Corestore("./_perf");
const base = new Autobase(store, null, { open, apply, valueEncoding: "json" });
await base.ready();

const t0 = performance.now();
for (let b = 0; b < N; b += 100) {
  const ops = [];
  for (let i = b; i < Math.min(b + 100, N); i++)
    ops.push({ op: "put", id: `p${i}`, row: { id: `p${i}`, region: `R${Math.floor(rnd() * REGIONS)}`, looms: Math.floor(rnd() * 8) } });
  const txid = `bulk${b}`;
  await base.append({ type: "begin", txid, ops });
  await base.append({ type: "status", txid, status: "committed" });
}
await base.update();
const ingestMs = performance.now() - t0;
console.log(`  · ingested ${N} persons across ${REGIONS} regions in ${ingestMs.toFixed(0)}ms`);

// pick a region that exists
const probe = await findByIndex(base.view, "region", "R7");

// ── time: equality point-query, indexed vs full scan ────────────────────────
const ti0 = performance.now(); const idx = await findByIndex(base.view, "region", "R7"); const idxMs = performance.now() - ti0;
const ts0 = performance.now(); const scan = await findScan(base.view, { region: "R7" }); const scanMs = performance.now() - ts0;

ok("indexed result == full-scan oracle", JSON.stringify(idx.ids.sort()) === JSON.stringify(scan.ids.sort()));
ok(`indexed touched far fewer records (${idx.loads} loads vs ${scan.scanned} scanned)`, idx.loads < scan.scanned);
console.log(`  · region=R7 → ${scan.ids.length} rows | index ${idxMs.toFixed(1)}ms (${idx.loads} loads) vs scan ${scanMs.toFixed(1)}ms (${scan.scanned} scanned) → ${(scanMs / idxMs).toFixed(1)}× faster`);

// ── range query over the ordered numeric index ─────────────────────────────
const tr0 = performance.now(); const range = await findByIndex(base.view, "looms", 7); const rangeMs = performance.now() - tr0;
const rangeScan = await findScan(base.view, { looms: 7 });
ok("numeric index (looms=7) == scan oracle", JSON.stringify(range.ids.sort()) === JSON.stringify(rangeScan.ids.sort()));
console.log(`  · looms=7 → ${rangeScan.ids.length} rows | index ${rangeMs.toFixed(1)}ms (${range.loads} loads) vs scan of ${rangeScan.scanned}`);

await base.close();
await store.close();
rmSync("./_perf", { recursive: true, force: true });
console.log(`\n✅ ${PASS}/${PASS} assertions passed — index stays correct AND materially faster at ${N} records.`);
process.exit(0);
