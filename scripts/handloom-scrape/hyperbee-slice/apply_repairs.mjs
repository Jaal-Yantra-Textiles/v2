// Apply census auto-repairs to the PUBLIC core — agg/idx/rec consistent.
//
// The audit (audit_census.py) re-crawls sampled records from source, diffs them
// against what was seeded, and writes CORRECTED full records (asdict shape) to a
// repairs jsonl. This applier folds those corrections into the live PUBLIC core
// WITHOUT drifting the aggregates or the secondary index — it computes the exact
// agg delta (old record's dims removed, new record's dims added) and moves the
// idx cells, then overwrites the masked record. Repairing a record that was
// MISSING is just the "no old dims" case (net add).
//
// The core is single-writer, so the seeder MUST be stopped:
//   sudo systemctl stop handloom-seed
//   cd /opt/handloom/jyt/scripts/handloom-scrape/hyperbee-slice
//   P2P_STORE=/opt/handloom/p2p-store node apply_repairs.mjs ../data/repairs/<run>.jsonl        # DRY RUN (default)
//   P2P_STORE=/opt/handloom/p2p-store node apply_repairs.mjs ../data/repairs/<run>.jsonl --apply # write
//   sudo systemctl start handloom-seed
//
//   node apply_repairs.mjs --test    # self-verify agg/idx/rec deltas on a scratch store
//
// NOTE: the masking/aggregation logic (SENSITIVE/SPECIAL_CATEGORY/band/
// splitRecord/bumpInto) MUST mirror seed_p2p.mjs exactly — it's duplicated here
// (rather than imported) only because seed_p2p.mjs runs the seeder at import.
// Keep them in sync.

import Corestore from "corestore"
import Hyperbee from "hyperbee"
import { brotliCompressSync, brotliDecompressSync } from "node:zlib"
import { readFileSync } from "node:fs"

import { fileURLToPath } from "node:url"

import { idxRelKeys, geoPayload } from "./census_index.mjs"

// True only when this file is the entry point (not when imported).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

// ── mirror of seed_p2p.mjs masking + aggregation (keep in sync) ──────────────
const SENSITIVE = ["mobile", "name", "head_of_household", "latitude", "longitude",
  "house_no", "pin_code", "monthly_income", "handloom_income", "aadhaar_issued", "profile_photo_url"]
const SPECIAL_CATEGORY = ["social_group", "religion"]
const band = (v, step) => {
  const n = Number(v)
  return v == null || Number.isNaN(n) ? null
    : `${Math.floor(n / step) * step}-${Math.floor(n / step) * step + step - 1}`
}
function splitRecord(r) {
  const pub = { ...r }
  for (const f of [...SENSITIVE, ...SPECIAL_CATEGORY]) delete pub[f]
  pub.age_band = band(r.age, 10)
  pub.income_band = band(r.handloom_income, 5000)
  pub.mobile_masked = r.mobile_masked || "91XXXXXXXXXX"
  return pub
}
function bumpInto(m, r) {
  const inc = (k) => m.set(k, (m.get(k) || 0) + 1)
  const add = (k, n) => m.set(k, (m.get(k) || 0) + (n || 0))
  inc(`state/${r.state}`)
  inc(`district/${r.state}|${r.district}`)
  if (r.gender) inc(`gender/${r.gender}`)
  inc(`natural_dye/${!!r.natural_dye_used}`)
  for (const ch of ["local_market", "master_weaver", "cooperative", "ecommerce"])
    if (r[`sells_${ch}`]) inc(`sales/${ch}`)
  for (const t of ["pit", "frame", "loin", "other"]) add(`loom_type/${t}`, r[`${t}_loom_count`])
  add(`total/looms_owned`, r.total_looms_owned)
  add(`total/weavers`, 1)
}
// ─────────────────────────────────────────────────────────────────────────────

const SEP = Buffer.from([0])
const subKey = (name, k) => Buffer.concat([Buffer.from(name), SEP, Buffer.from(String(k))])
const decode = (buf) => JSON.parse(brotliDecompressSync(buf).toString())
const enc = (r) => brotliCompressSync(Buffer.from(JSON.stringify(r)))
const EMPTY = Buffer.from("")

/**
 * Fold corrected records into the public core with exact agg/idx deltas.
 * Returns a summary { applied, added, changed, aggDeltas, idxAdded, idxRemoved }.
 */
export async function applyRepairs(bee, records, { dryRun = true } = {}) {
  const rec = bee.sub("rec", { valueEncoding: "binary" })
  const agg = bee.sub("agg", { valueEncoding: "utf-8" })

  const aggDelta = new Map()   // agg key -> net change
  const recPuts = []           // [id, encodedPubRow]
  const idxAdd = []            // sub-relative idx keys to add
  const idxDel = []            // sub-relative idx keys to remove
  let added = 0, changed = 0

  for (const r of records) {
    if (r == null || r.census_id == null) continue
    const id = String(r.census_id)
    const newPub = splitRecord(r)

    const oldNode = await rec.get(id)
    const oldPub = oldNode ? decode(oldNode.value) : null
    if (oldPub) changed++; else added++

    // agg delta = new dims - old dims
    const nm = new Map(); bumpInto(nm, newPub)
    const om = new Map(); if (oldPub) bumpInto(om, oldPub)
    for (const k of new Set([...nm.keys(), ...om.keys()])) {
      const d = (nm.get(k) || 0) - (om.get(k) || 0)
      if (d !== 0) aggDelta.set(k, (aggDelta.get(k) || 0) + d)
    }

    // idx delta. Re-put the inline geo payload on EVERY current family (not just
    // newly-added keys) so a repair that changed a display field refreshes the
    // value the reader browses; delete only families the record left.
    const idxVal = brotliCompressSync(Buffer.from(JSON.stringify(geoPayload(newPub))))
    const newIdx = new Set(idxRelKeys(newPub))
    const oldIdx = new Set(oldPub ? idxRelKeys(oldPub) : [])
    for (const k of newIdx) idxAdd.push([k, idxVal])
    for (const k of oldIdx) if (!newIdx.has(k)) idxDel.push(k)

    recPuts.push([id, enc(newPub)])
  }

  if (!dryRun) {
    const batch = bee.batch({ keyEncoding: "binary", valueEncoding: "binary" })
    for (const [id, val] of recPuts) await batch.put(subKey("rec", id), val)
    for (const [k, val] of idxAdd) await batch.put(subKey("idx", k), val)
    for (const k of idxDel) await batch.del(subKey("idx", k))
    for (const [k, d] of aggDelta) {
      const cur = await agg.get(k)
      await batch.put(subKey("agg", k), Buffer.from(String((cur ? Number(cur.value) : 0) + d)))
    }
    await batch.flush()
  }

  return {
    applied: !dryRun,
    records: records.length,
    added,
    changed,
    aggDeltas: aggDelta.size,
    idxAdded: idxAdd.length,
    idxRemoved: idxDel.length,
  }
}

// ── self-test ────────────────────────────────────────────────────────────────
if (isMain && process.argv.includes("--test")) {
  const assert = (await import("node:assert")).default
  const { rmSync } = await import("node:fs")
  const DIR = "./.repairs-selftest-store"
  rmSync(DIR, { recursive: true, force: true })
  const store = new Corestore(DIR)
  const core = store.get({ name: "repairs-selftest" })
  await core.ready()
  const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" })
  await bee.ready()

  const agg = bee.sub("agg", { valueEncoding: "utf-8" })
  const idx = bee.sub("idx", { valueEncoding: "binary" })
  const rec = bee.sub("rec", { valueEncoding: "binary" })
  const getAgg = async (k) => Number((await agg.get(k))?.value ?? 0)
  const hasIdx = async (k) => (await idx.get(k)) != null

  // seed one record via the same public split + agg, plus its idx.
  const seed0 = { census_id: 500, state: "KARNATAKA", district: "BAGALKOT", gender: "Male", total_looms_owned: 2, pit_loom_count: 1 }
  {
    const pub = splitRecord(seed0)
    const m = new Map(); bumpInto(m, pub)
    const b = bee.batch({ keyEncoding: "binary", valueEncoding: "binary" })
    await b.put(subKey("rec", 500), enc(pub))
    for (const [k, v] of m) await b.put(subKey("agg", k), Buffer.from(String(v)))
    for (const k of idxRelKeys(pub)) await b.put(subKey("idx", k), EMPTY)
    await b.flush()
  }

  let pass = 0
  const ok = (l, c) => { assert(c, `FAIL: ${l}`); console.log(`  ✓ ${l}`); pass++ }

  ok("baseline agg state/KARNATAKA == 1", (await getAgg("state/KARNATAKA")) === 1)
  ok("baseline idx has KARNATAKA cell", await hasIdx(`state/KARNATAKA/${String(500).padStart(10, "0")}`))

  // dry-run changes nothing.
  const corrected = { ...seed0, state: "PUNJAB", district: "AMRITSAR" } // source says the state was wrong
  const dry = await applyRepairs(bee, [corrected], { dryRun: true })
  ok("dry-run reports 1 changed, 0 added", dry.changed === 1 && dry.added === 0)
  ok("dry-run left agg untouched", (await getAgg("state/KARNATAKA")) === 1 && (await getAgg("state/PUNJAB")) === 0)

  // apply the repair: KARNATAKA -1, PUNJAB +1; idx moved; rec updated.
  await applyRepairs(bee, [corrected], { dryRun: false })
  ok("agg decremented old state (KARNATAKA -> 0)", (await getAgg("state/KARNATAKA")) === 0)
  ok("agg incremented new state (PUNJAB -> 1)", (await getAgg("state/PUNJAB")) === 1)
  ok("agg total/weavers unchanged at 1 (a repair is not a new head-count)", (await getAgg("total/weavers")) === 1)
  ok("old idx cell removed", !(await hasIdx(`state/KARNATAKA/${String(500).padStart(10, "0")}`)))
  ok("new idx cell added", await hasIdx(`state/PUNJAB/${String(500).padStart(10, "0")}`))
  const updated = decode((await rec.get("500")).value)
  ok("rec overwritten with corrected state", updated.state === "PUNJAB" && updated.district === "AMRITSAR")

  // repairing a MISSING record is a net add.
  const fresh = { census_id: 501, state: "GOA", district: "NORTH GOA", gender: "Female", total_looms_owned: 1 }
  await applyRepairs(bee, [fresh], { dryRun: false })
  ok("missing-record repair adds agg state/GOA == 1", (await getAgg("state/GOA")) === 1)
  ok("missing-record repair adds idx cell", await hasIdx(`state/GOA/${String(501).padStart(10, "0")}`))

  await store.close()
  rmSync(DIR, { recursive: true, force: true })
  console.log(`\n✅ ${pass}/${pass} — auto-repair keeps agg + idx + rec consistent (delta-correct, dry-run-safe).`)
  process.exit(0)
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMain && !process.argv.includes("--test")) {
  const file = process.argv[2]
  if (!file) {
    console.error("usage: node apply_repairs.mjs <repairs.jsonl> [--apply]   (dry-run without --apply)")
    process.exit(1)
  }
  const apply = process.argv.includes("--apply")
  const STORE_DIR = process.env.P2P_STORE || "./p2p-store"
  const CORE_NAME = process.env.PUBLIC_CORE_NAME || "handloom-public-v1"

  const records = readFileSync(file, "utf-8")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)

  const store = new Corestore(STORE_DIR)
  const core = store.get({ name: CORE_NAME })
  await core.ready()
  if (apply && !core.writable) {
    console.error(`✗ core not writable — stop the seeder first (sudo systemctl stop handloom-seed).`)
    await store.close(); process.exit(1)
  }
  const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" })
  await bee.ready()

  const summary = await applyRepairs(bee, records, { dryRun: !apply })
  console.log(`${apply ? "APPLIED" : "DRY-RUN"}:`, JSON.stringify(summary))
  if (!apply) console.log("(re-run with --apply to write; the seeder must be stopped)")
  await store.close()
  process.exit(0)
}
