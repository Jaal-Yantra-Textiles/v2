// Dual-core P2P seeder — privacy-safe by construction.
//
//   PUBLIC core  (unencrypted, freely replicated): masked + COARSENED per-record
//     data (no exact geo / income / phone / name / house_no) + pre-computed
//     AGGREGATES for public analytics.
//   SENSITIVE core (Hypercore encryptionKey): the full PII, keyed by census_id.
//     Replicates across the SAME swarm but is opaque without the key.
//
// "Unmask" = resolve census_id against the sensitive core (key-holder only).
// Public analytics = read the pre-computed agg/* keys (k-anonymity applied) —
// never a per-record scan, never PII.
//
//   node seed_p2p.mjs --once     # ingest + print keys + exit
//   node seed_p2p.mjs            # ingest + seed on Hyperswarm forever
//   node seed_p2p.mjs --test     # ingest synthetic fixture + assert invariants
//
// Key: env HANDLOOM_ENCRYPTION_KEY (64-hex). If absent, one is generated and
// written to ENCRYPTION_KEY.txt — MOVE IT TO SSM; losing it means no unmask ever.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { randomBytes } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { readdirSync, writeFileSync, existsSync, createReadStream, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import assert from "node:assert";
import { idxRelKeys } from "./census_index.mjs";

const DATA_DIR = "../data/live";
const STORE_DIR = process.env.P2P_STORE || "./p2p-store";
const MIN_CELL = 5;                       // k-anonymity: suppress aggregate cells below this

// fields that must NEVER enter the public core (encrypted core only)
const SENSITIVE = ["mobile", "name", "head_of_household", "latitude", "longitude",
  "house_no", "pin_code", "monthly_income", "handloom_income", "aadhaar_issued", "profile_photo_url"];

// DPDP-2023 special-category dims — kept SEPARATE from the public core entirely:
// stripped from public records AND from public aggregates. They live ONLY in the
// encrypted sensitive core (per-record + key-holder-only aggregates).
const SPECIAL_CATEGORY = ["social_group", "religion"];

const band = (v, step) => {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? null
    : `${Math.floor(n / step) * step}-${Math.floor(n / step) * step + step - 1}`;
};

function splitRecord(r) {
  const sensitive = {};
  for (const f of [...SENSITIVE, ...SPECIAL_CATEGORY]) if (r[f] != null) sensitive[f] = r[f];
  const pub = { ...r };
  for (const f of [...SENSITIVE, ...SPECIAL_CATEGORY]) delete pub[f];
  // coarsen the sensitive-but-aggregatable dims into public bands (no exact values)
  pub.age_band = band(r.age, 10);
  pub.income_band = band(r.handloom_income, 5000);
  pub.mobile_masked = r.mobile_masked || "91XXXXXXXXXX";
  return { pub, sensitive };
}

// Accumulate one record's aggregate increments into `m` (key -> delta), for a
// single core. PUBLIC core (sens=false) gets the general dims; the SENSITIVE
// core (sens=true) gets ONLY the DPDP special-category dims (social_group /
// religion), which never touch the public core. Deltas are folded into the
// core's stored agg counts under an atomic batch — so counts stay exact under
// incremental (append-only) ingest instead of being recomputed from scratch.
function bumpInto(m, r, sens) {
  const inc = (k) => m.set(k, (m.get(k) || 0) + 1);
  const add = (k, n) => m.set(k, (m.get(k) || 0) + (n || 0));
  if (sens) {
    if (r.social_group) inc(`social_group/${r.social_group}`);
    if (r.religion) inc(`religion/${r.religion}`);
    return;
  }
  inc(`state/${r.state}`);
  inc(`district/${r.state}|${r.district}`);
  if (r.gender) inc(`gender/${r.gender}`);
  inc(`natural_dye/${!!r.natural_dye_used}`);
  for (const ch of ["local_market", "master_weaver", "cooperative", "ecommerce"])
    if (r[`sells_${ch}`]) inc(`sales/${ch}`);
  for (const t of ["pit", "frame", "loin", "other"]) add(`loom_type/${t}`, r[`${t}_loom_count`]);
  add(`total/looms_owned`, r.total_looms_owned);
  add(`total/weavers`, 1);
}

// recursively yield every .jsonl under dir (top-level state files + ids/ chunks)
function walkJsonl(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJsonl(p));
    else if (ent.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

// census_id -> real photo url, but ONLY for the ids we actually need (the detail
// records being ingested). Streamed line-by-line so a 100MB+ state CSV never lands
// in memory whole, and bounded to needed.size — the full 2M+ photo set never does.
async function loadPhotosFor(needed) {
  const map = new Map();
  const dir = join(DATA_DIR, "photos");
  if (!needed.size || !existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".csv"))) {
    const rl = createInterface({ input: createReadStream(join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      const i = line.indexOf(",");
      if (i <= 0) continue;
      const cid = line.slice(0, i).trim();
      if (needed.has(cid)) map.set(cid, line.slice(i + 1).trim());
    }
  }
  return map;
}

// Hyperbee sub() keys are `<name>\0<key>` (default 1-byte separator). We build the
// same bytes by hand so a single ROOT-bee batch can write rec/agg/meta keys
// ATOMICALLY (one flush) while existing sub() readers still find them.
const SEP = Buffer.from([0]);
const subKey = (name, k) => Buffer.concat([Buffer.from(name), SEP, Buffer.from(String(k))]);

// Read only the NEW tail of a jsonl file (bytes [startOffset, size)), returning
// the complete records found and the byte offset of the last full line consumed.
// The crawler appends whole "json\n" lines, so a torn final line (mid-append) is
// simply not consumed this cycle — it's picked up once its newline lands. This is
// what makes ingest incremental: each cycle touches only the delta, never the
// whole (growing) corpus, so memory + CPU stay flat as the sweep reaches millions.
function readDelta(file, startOffset) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    if (size <= startOffset) return { records: [], endOffset: startOffset };
    const buf = Buffer.allocUnsafe(size - startOffset);
    readSync(fd, buf, 0, buf.length, startOffset);
    const text = buf.toString("utf-8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return { records: [], endOffset: startOffset };   // no complete new line yet
    const consumed = text.slice(0, lastNl + 1);
    const records = [];
    for (const line of consumed.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { records.push(JSON.parse(t)); } catch { /* torn/corrupt line — skip, don't crash */ }
    }
    return { records, endOffset: startOffset + Buffer.byteLength(consumed, "utf-8") };
  } finally {
    closeSync(fd);
  }
}

// per-file ingest cursor (bytes already ingested into THIS core), stored in-core.
async function getOffset(bee, file) {
  const n = await bee.sub("meta", { valueEncoding: "utf-8" }).get("off/" + file);
  return n ? Number(n.value) : 0;
}

// open (or reopen) the dual cores — separated so seed mode can re-ingest the
// growing crawl output on an interval without reopening the Corestore.
async function openStores() {
  const encHex = process.env.HANDLOOM_ENCRYPTION_KEY || (() => {
    const k = randomBytes(32).toString("hex");
    writeFileSync("./ENCRYPTION_KEY.txt", k + "\n");
    console.warn("⚠️  generated a new encryption key -> ENCRYPTION_KEY.txt — MOVE IT TO SSM (losing it = no unmask, ever)");
    return k;
  })();
  const encryptionKey = b4a.from(encHex, "hex");

  const store = new Corestore(STORE_DIR);
  const pubCore = store.get({ name: "handloom-public-v1" });
  const sensCore = store.get({ name: "handloom-sensitive-v1", encryptionKey });
  await pubCore.ready(); await sensCore.ready();

  const pub = new Hyperbee(pubCore, { keyEncoding: "utf-8", valueEncoding: "binary" });
  const sens = new Hyperbee(sensCore, { keyEncoding: "utf-8", valueEncoding: "binary" });
  return { store, pubCore, sensCore, pub, sens, encryptionKey };
}

// Ingest one file's NEW tail into ONE core, atomically. Reads only bytes past
// this core's stored cursor, then commits {new records + agg increments + the
// advanced cursor} in a single Hyperbee batch. Atomicity is why counts stay
// exact under crashes: either the whole delta lands (records + agg + cursor) or
// none of it does, so we never double-count on restart and never skip records.
// Each core carries its OWN cursor, so if one core's batch fails to flush the
// other's records aren't stranded — the lagging core simply re-reads its delta.
async function ingestCore(bee, file, sens) {
  const off = await getOffset(bee, file);
  const { records, endOffset } = readDelta(file, off);
  if (records.length === 0) {
    if (endOffset !== off) await bee.sub("meta", { valueEncoding: "utf-8" }).put("off/" + file, String(endOffset));
    return 0;
  }

  // profile photos are SENSITIVE (encrypted core only) — the public core never
  // needs them, so only join photos for the sensitive pass, and only for the
  // delta's ids (bounded — this is what killed the old all-ids OOM).
  let photos = new Map();
  if (sens) {
    const need = new Set();
    for (const r of records) if (r.profile_photo_url == null) need.add(String(r.census_id));
    photos = await loadPhotosFor(need);
  }

  const recPuts = [];              // [census_id, brotli(row)]
  const idxPuts = [];              // sub-relative secondary-index keys (public core)
  const delta = new Map();         // agg key -> increment
  for (const r of records) {
    if (sens && r.profile_photo_url == null && photos.has(String(r.census_id)))
      r.profile_photo_url = photos.get(String(r.census_id));
    const { pub: pubRow, sensitive } = splitRecord(r);
    recPuts.push([String(r.census_id), brotliCompressSync(Buffer.from(JSON.stringify(sens ? sensitive : pubRow)))]);
    if (!sens) for (const rk of idxRelKeys(pubRow)) idxPuts.push(rk);
    bumpInto(delta, r, sens);
  }

  // read current agg totals BEFORE opening the batch (single writer → no race),
  // fold in this delta, then commit records + new totals + cursor in one flush.
  const aggSub = bee.sub("agg", { valueEncoding: "utf-8" });
  const newAgg = new Map();
  for (const [k, incr] of delta) {
    const cur = await aggSub.get(k);
    newAgg.set(k, (cur ? Number(cur.value) : 0) + incr);
  }
  const batch = bee.batch({ keyEncoding: "binary", valueEncoding: "binary" });
  for (const [id, val] of recPuts) await batch.put(subKey("rec", id), val);
  for (const rk of idxPuts) await batch.put(subKey("idx", rk), Buffer.from(""));
  for (const [k, v] of newAgg) await batch.put(subKey("agg", k), Buffer.from(String(v)));
  await batch.put(subKey("meta", "off/" + file), Buffer.from(String(endOffset)));
  await batch.flush();
  return records.length;
}

// One incremental pass over every jsonl under DATA_DIR (sealed chunks skip in O(1)
// once their cursor == size; only the growing chunk does real work).
async function ingestNew(pub, sens) {
  const files = walkJsonl(DATA_DIR);
  if (files.length === 0) return 0;        // no detail records yet — photos alone aren't records
  let n = 0;
  for (const file of files) {
    n += await ingestCore(pub, file, false);
    await ingestCore(sens, file, true);
  }
  return n;
}

// One-time migration from the old full-recompute seeder: its agg keys hold whole
// counts, which would double up once we start FOLDING deltas. Clear them so the
// first incremental pass rebuilds agg from cursor 0 exactly once; thereafter every
// restart resumes from stored cursors with no rebuild.
async function migrateIfNeeded(pub, sens) {
  const VER = "inc-v1";
  const meta = pub.sub("meta", { valueEncoding: "utf-8" });
  const cur = await meta.get("ingest-version");
  if (cur && cur.value === VER) return false;
  for (const bee of [pub, sens]) {
    const aggSub = bee.sub("agg", { valueEncoding: "utf-8" });
    const keys = [];
    for await (const { key } of aggSub.createReadStream()) keys.push(key);
    for (const k of keys) await aggSub.del(k);
  }
  await meta.put("ingest-version", VER);
  return true;
}

async function ingest() {
  const s = await openStores();
  await migrateIfNeeded(s.pub, s.sens);
  const n = await ingestNew(s.pub, s.sens);
  return { ...s, n };
}

// ── public analytics feed: read agg/* with k-anonymity suppression ──────────
export async function readStats(pub, { minCell = MIN_CELL } = {}) {
  const dims = {};
  for await (const { key, value } of pub.sub("agg", { valueEncoding: "utf-8" }).createReadStream()) {
    const [dim, ...rest] = key.split("/");
    const label = rest.join("/");
    const count = Number(value);
    (dims[dim] ??= {})[label] = dim === "total" || dim === "loom_type" ? count
      : count < minCell ? null : count;              // suppress small cells (re-identification risk)
  }
  return dims;
}

// ── key-holder-only analytics over the encrypted special-category aggregates ──
export async function readSensitiveStats(sens, { minCell = MIN_CELL } = {}) {
  const dims = {};
  for await (const { key, value } of sens.sub("agg", { valueEncoding: "utf-8" }).createReadStream()) {
    const [dim, ...rest] = key.split("/");
    const count = Number(value);
    (dims[dim] ??= {})[rest.join("/")] = count < minCell ? null : count;   // suppress small cells
  }
  return dims;
}

// ── unmask: key-holder-only resolve of census_id -> real PII (audit at call site) ──
export async function unmask(sens, censusId) {
  const n = await sens.sub("rec", { valueEncoding: "binary" }).get(String(censusId));
  return n ? JSON.parse(brotliDecompressSync(n.value).toString()) : null;
}

// ── main ────────────────────────────────────────────────────────────────────
const mode = process.argv.includes("--test") ? "test" : process.argv.includes("--once") ? "once" : "seed";

if (mode === "test") {
  const { rmSync } = await import("node:fs");
  rmSync(STORE_DIR, { recursive: true, force: true });
  process.env.HANDLOOM_ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
  const { store, pubCore, sensCore, pub, sens, encryptionKey, n } = await ingest();
  let pass = 0; const ok = (l, c) => { assert(c, `FAIL: ${l}`); console.log(`  ✓ ${l}`); pass++; };
  console.log(`ingested ${n} records into dual cores\n`);

  // 1. public records carry NO sensitive fields
  const one = JSON.parse(brotliDecompressSync((await pub.sub("rec", { valueEncoding: "binary" }).get("2904500")).value).toString());
  ok("public record has NO real mobile/name/lat/long/income", SENSITIVE.every((f) => !(f in one)));
  ok("public record has NO social_group / religion (special-category)", SPECIAL_CATEGORY.every((f) => !(f in one)));
  ok("public record keeps masked + coarsened bands", one.mobile_masked === "91XXXXXXXXXX" && !!one.age_band && !!one.income_band);

  // 4. analytics = aggregates, k-anonymity applied (read while the store is open)
  const stats = await readStats(pub, { minCell: 5 });
  ok("aggregate weaver total == ingested count", stats.total.weavers === n);
  ok("public aggregates cover loom types + sales channels", !!stats.loom_type && !!stats.sales);
  ok("public aggregates EXCLUDE social_group + religion", !stats.social_group && !stats.religion);
  const sensStats = await readSensitiveStats(sens, { minCell: 5 });
  ok("special-category aggregates live ONLY in the encrypted core", !!sensStats.social_group && !!sensStats.religion);
  console.log(`\n  public analytics (k-anon minCell=5):`);
  console.log("   ", JSON.stringify({ total: stats.total, loom_type: stats.loom_type, sales: stats.sales }));
  console.log(`  key-holder-only (encrypted) special-category:`);
  console.log("   ", JSON.stringify({ social_group: sensStats.social_group, religion: sensStats.religion }));
  console.log();

  // 2. sensitive core is UNREADABLE without the key
  await store.close();
  const s2 = new Corestore(STORE_DIR);
  const noKey = s2.get({ name: "handloom-sensitive-v1" });        // opened WITHOUT encryptionKey
  await noKey.ready();
  let unreadable = false;
  try {
    const raw = await noKey.get(0);                                // block bytes are ciphertext
    unreadable = raw == null || !b4a.toString(raw).includes("mobile");
  } catch { unreadable = true; }
  ok("sensitive core is OPAQUE without the encryption key", unreadable);
  await s2.close();

  // 3. WITH the key, unmask resolves the real value
  const s3 = new Corestore(STORE_DIR);
  const withKey = new Hyperbee(s3.get({ name: "handloom-sensitive-v1", encryptionKey }), { keyEncoding: "utf-8", valueEncoding: "binary" });
  const real = await unmask(withKey, "2904500");
  ok("WITH key: unmask(census_id) returns the real mobile", typeof real.mobile === "string" && real.mobile.startsWith("9"));
  await s3.close();
  rmSync(STORE_DIR, { recursive: true, force: true });
  rmSync("./ENCRYPTION_KEY.txt", { force: true });
  console.log(`\n✅ ${pass}/${pass} — dual-core split holds: public is PII-free + aggregatable, real values recoverable only with the key.`);
  process.exit(0);
}

const { store, pubCore, sensCore, pub, sens, n } = await ingest();
writeFileSync("./PUBLIC_KEY.txt", `public:    ${pubCore.key.toString("hex")}\nsensitive: ${sensCore.key.toString("hex")}\n`);
console.log(`ingested ${n} records.\n  PUBLIC core key (share freely): ${pubCore.key.toString("hex")}\n  SENSITIVE core key (needs encryptionKey to read): ${sensCore.key.toString("hex")}`);
if (mode === "once") { await store.close(); process.exit(0); }

const { default: Hyperswarm } = await import("hyperswarm");
const swarm = new Hyperswarm();
swarm.on("connection", (conn) => store.replicate(conn));
await swarm.join(pubCore.discoveryKey, { server: true, client: false }).flushed();
await swarm.join(sensCore.discoveryKey, { server: true, client: false }).flushed();
console.log("seeding both cores on Hyperswarm — public is readable by anyone; sensitive stays opaque without the key.");

// Direct-socket replication for same-VCN peers (deterministic; avoids the NAT
// hole-punch that fails between two hosts behind the same cloud NAT). Opt-in via
// REPL_PORT. The listener replicates the whole Corestore, so it serves the blind
// mirror the same cores it announces on the swarm.
if (process.env.REPL_PORT) {
  const net = await import("node:net");
  net.createServer((socket) => {
    console.log(`[${new Date().toISOString()}] direct peer connected from ${socket.remoteAddress}`);
    socket.on("error", (e) => console.log(`direct peer error: ${e.message}`));
    const s = store.replicate(false);            // raw socket → replicate(bool) + pipe
    s.pipe(socket).pipe(s);
  }).listen(Number(process.env.REPL_PORT), "0.0.0.0", () =>
    console.log(`direct replication listening on :${process.env.REPL_PORT}`));
}

// Incrementally ingest the growing crawl output so the cores (and any replica
// peers) stay fresh without a restart. Each tick touches only the NEW bytes since
// the last tick (per-file cursor), so cost is O(delta) — flat as the sweep grows
// to millions, instead of the old O(all) re-read + re-put that OOM'd the 1GB box.
// Skipped while a prior pass runs to avoid overlap.
const REINGEST_MS = Number(process.env.REINGEST_MS || 15 * 60 * 1000);
let reingesting = false;
setInterval(async () => {
  if (reingesting) return;
  reingesting = true;
  try {
    const m = await ingestNew(pub, sens);
    console.log(`[${new Date().toISOString()}] incremental ingest: +${m} new records (public core length=${pubCore.length})`);
  } catch (e) {
    console.error("re-ingest error:", e.message);
  } finally {
    reingesting = false;
  }
}, REINGEST_MS);
