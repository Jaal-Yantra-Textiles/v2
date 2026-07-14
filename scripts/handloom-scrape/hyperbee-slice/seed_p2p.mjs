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
import { readFileSync, readdirSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import assert from "node:assert";

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

// PUBLIC aggregates (agg) exclude special-category dims; those go into sensAgg,
// which is written ONLY to the encrypted sensitive core (key-holder analytics).
function bumpAll(agg, sensAgg, r) {
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const add = (m, k, n) => m.set(k, (m.get(k) || 0) + (n || 0));
  inc(agg, `state/${r.state}`);
  inc(agg, `district/${r.state}|${r.district}`);
  if (r.gender) inc(agg, `gender/${r.gender}`);
  inc(agg, `natural_dye/${!!r.natural_dye_used}`);
  for (const ch of ["local_market", "master_weaver", "cooperative", "ecommerce"])
    if (r[`sells_${ch}`]) inc(agg, `sales/${ch}`);
  for (const t of ["pit", "frame", "loin", "other"]) add(agg, `loom_type/${t}`, r[`${t}_loom_count`]);
  add(agg, `total/looms_owned`, r.total_looms_owned);
  add(agg, `total/weavers`, 1);
  // special-category → encrypted aggregates only
  if (r.social_group) inc(sensAgg, `social_group/${r.social_group}`);
  if (r.religion) inc(sensAgg, `religion/${r.religion}`);
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

// stream a jsonl file's records (avoids readFileSync().split on large chunks)
async function* readRecords(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
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

// idempotent: (re)reads every jsonl under DATA_DIR and upserts by census_id, so
// calling it repeatedly as the detail sweep grows just appends the new records.
async function ingestFiles(pub, sens) {
  const files = walkJsonl(DATA_DIR);
  if (files.length === 0) return 0;        // no detail records yet — skip (photos alone aren't records)

  const pubRec = pub.sub("rec", { valueEncoding: "binary" });
  const pubAgg = pub.sub("agg", { valueEncoding: "utf-8" });
  const sensRec = sens.sub("rec", { valueEncoding: "binary" });
  const sensAggBee = sens.sub("agg", { valueEncoding: "utf-8" });

  // pass 1 (streamed): which census_ids need a photo joined
  const needPhoto = new Set();
  for (const file of files)
    for await (const r of readRecords(file))
      if (r.profile_photo_url == null) needPhoto.add(String(r.census_id));
  const photos = await loadPhotosFor(needPhoto);   // bounded to needPhoto, streamed

  // pass 2 (streamed): upsert every record by census_id
  const agg = new Map(), sensAgg = new Map();
  let n = 0;
  for (const file of files) {
    for await (const r of readRecords(file)) {
      if (r.profile_photo_url == null && photos.has(String(r.census_id)))
        r.profile_photo_url = photos.get(String(r.census_id));   // join the 2nd-pass photo
      const { pub: pubRow, sensitive } = splitRecord(r);
      await pubRec.put(String(r.census_id), brotliCompressSync(Buffer.from(JSON.stringify(pubRow))));
      await sensRec.put(String(r.census_id), brotliCompressSync(Buffer.from(JSON.stringify(sensitive))));
      bumpAll(agg, sensAgg, r);
      n++;
    }
  }
  for (const [k, v] of agg) await pubAgg.put(k, String(v));
  for (const [k, v] of sensAgg) await sensAggBee.put(k, String(v));   // encrypted-core only
  return n;
}

async function ingest() {
  const s = await openStores();
  const n = await ingestFiles(s.pub, s.sens);
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

// Re-ingest the growing crawl output so the cores (and any replica peers) stay
// fresh without a service restart. Idempotent upsert by census_id; skipped while
// a prior pass is still running to avoid overlap.
const REINGEST_MS = Number(process.env.REINGEST_MS || 15 * 60 * 1000);
let reingesting = false;
setInterval(async () => {
  if (reingesting) return;
  reingesting = true;
  try {
    const m = await ingestFiles(pub, sens);
    console.log(`[${new Date().toISOString()}] re-ingest: ${m} records now in cores (public core length=${pubCore.length})`);
  } catch (e) {
    console.error("re-ingest error:", e.message);
  } finally {
    reingesting = false;
  }
}, REINGEST_MS);
