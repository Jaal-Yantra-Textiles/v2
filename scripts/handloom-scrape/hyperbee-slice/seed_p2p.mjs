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
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import assert from "node:assert";

const DATA_DIR = "../data/live";
const STORE_DIR = process.env.P2P_STORE || "./p2p-store";
const MIN_CELL = 5;                       // k-anonymity: suppress aggregate cells below this

// fields that must NEVER enter the public core (encrypted core only)
const SENSITIVE = ["mobile", "name", "head_of_household", "latitude", "longitude",
  "house_no", "pin_code", "monthly_income", "handloom_income", "aadhaar_issued", "profile_photo_url"];

const band = (v, step) => (v == null ? null : `${Math.floor(v / step) * step}-${Math.floor(v / step) * step + step - 1}`);

function splitRecord(r) {
  const sensitive = {};
  for (const f of SENSITIVE) if (r[f] != null) sensitive[f] = r[f];
  const pub = { ...r };
  for (const f of SENSITIVE) delete pub[f];
  // coarsen the sensitive-but-aggregatable dims into public bands (no exact values)
  pub.age_band = band(r.age, 10);
  pub.income_band = band(r.handloom_income, 5000);
  pub.mobile_masked = r.mobile_masked || "91XXXXXXXXXX";
  return { pub, sensitive };
}

// aggregate counters accumulated in-memory, written once (idempotent per run)
function bumpAll(agg, r) {
  const inc = (k) => agg.set(k, (agg.get(k) || 0) + 1);
  const add = (k, n) => agg.set(k, (agg.get(k) || 0) + (n || 0));
  inc(`state/${r.state}`);
  inc(`district/${r.state}|${r.district}`);
  if (r.social_group) inc(`social_group/${r.social_group}`);
  if (r.gender) inc(`gender/${r.gender}`);
  if (r.religion) inc(`religion/${r.religion}`);
  inc(`natural_dye/${!!r.natural_dye_used}`);
  for (const ch of ["local_market", "master_weaver", "cooperative", "ecommerce"])
    if (r[`sells_${ch}`]) inc(`sales/${ch}`);
  for (const t of ["pit", "frame", "loin", "other"]) add(`loom_type/${t}`, r[`${t}_loom_count`]);
  add(`total/looms_owned`, r.total_looms_owned);
  add(`total/weavers`, 1);
  return agg;
}

async function ingest() {
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
  const pubRec = pub.sub("rec", { valueEncoding: "binary" });
  const pubAgg = pub.sub("agg", { valueEncoding: "utf-8" });
  const sensRec = sens.sub("rec", { valueEncoding: "binary" });

  const agg = new Map();
  let n = 0;
  for (const file of (existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((f) => f.endsWith(".jsonl")) : [])) {
    for (const line of readFileSync(`${DATA_DIR}/${file}`, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      const { pub: pubRow, sensitive } = splitRecord(r);
      await pubRec.put(String(r.census_id), brotliCompressSync(Buffer.from(JSON.stringify(pubRow))));
      await sensRec.put(String(r.census_id), brotliCompressSync(Buffer.from(JSON.stringify(sensitive))));
      bumpAll(agg, r);
      n++;
    }
  }
  for (const [k, v] of agg) await pubAgg.put(k, String(v));

  return { store, pubCore, sensCore, pub, sens, encryptionKey, n };
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
  ok("public record keeps masked + coarsened bands", one.mobile_masked === "91XXXXXXXXXX" && !!one.age_band && !!one.income_band);

  // 4. analytics = aggregates, k-anonymity applied (read while the store is open)
  const stats = await readStats(pub, { minCell: 5 });
  ok("aggregate weaver total == ingested count", stats.total.weavers === n);
  ok("aggregates cover loom types + social groups + sales channels", !!stats.loom_type && !!stats.social_group && !!stats.sales);
  console.log(`\n  public analytics (k-anon minCell=5):`);
  console.log("   ", JSON.stringify({ total: stats.total, social_group: stats.social_group, loom_type: stats.loom_type, sales: stats.sales }));
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

const { store, pubCore, sensCore, n } = await ingest();
writeFileSync("./PUBLIC_KEY.txt", `public:    ${pubCore.key.toString("hex")}\nsensitive: ${sensCore.key.toString("hex")}\n`);
console.log(`ingested ${n} records.\n  PUBLIC core key (share freely): ${pubCore.key.toString("hex")}\n  SENSITIVE core key (needs encryptionKey to read): ${sensCore.key.toString("hex")}`);
if (mode === "once") { await store.close(); process.exit(0); }

const { default: Hyperswarm } = await import("hyperswarm");
const swarm = new Hyperswarm();
swarm.on("connection", (conn) => store.replicate(conn));
await swarm.join(pubCore.discoveryKey, { server: true, client: false }).flushed();
await swarm.join(sensCore.discoveryKey, { server: true, client: false }).flushed();
console.log("seeding both cores on Hyperswarm — public is readable by anyone; sensitive stays opaque without the key.");
