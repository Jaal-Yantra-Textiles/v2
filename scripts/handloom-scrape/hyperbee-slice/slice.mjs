// Handloom weaver store — Hyperbee proof-of-concept on the real AMBALA data.
//
// Demonstrates the full storage design locally (no infra):
//   - compressed (brotli) record values in an ordered B-tree KV
//   - a region index sub-db for prefix/range search + capacity counts
//   - real PII (mobile) kept in an ENCRYPTED core; masked value is public
//   - public read = masked; authorized (key-holder) read = real
//
// In production each of these cores is seeded/replicated across many small
// free servers (Hyperswarm), and readers replicate sparsely (on-demand).

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";

const records = JSON.parse(readFileSync("../data/live/ambala_sample.json", "utf8"));

// Corestore manages the cores; RAM keeps this a zero-infra local test.
const store = new Corestore("./_store");

// ---- PUBLIC store (replicates to everyone) ------------------------------
const publicCore = store.get({ name: "public" });
const publicBee = new Hyperbee(publicCore, { keyEncoding: "utf-8", valueEncoding: "binary" });
const recs = publicBee.sub("rec", { valueEncoding: "binary" });        // census_id -> brotli(json)
const region = publicBee.sub("region", { valueEncoding: "utf-8" });    // state/district/sub/id -> id

// ---- PRIVATE store (encrypted; only key-holders can read) ---------------
const encryptionKey = Buffer.alloc(32, "handloom-secret-key"); // demo key
const privateCore = store.get({ name: "private", encryptionKey });
const privateBee = new Hyperbee(privateCore, { keyEncoding: "utf-8", valueEncoding: "json" });

function maskMobile(rec) {
  // Public projection: drop the real number, keep the portal's mask + last-4 hint.
  const { mobile, ...pub } = rec;
  pub.mobile_masked = rec.mobile_masked || "91XXXXXXXXXX";
  return pub;
}

let rawBytes = 0, compBytes = 0;
for (const rec of records) {
  const id = String(rec.census_id);

  // public compressed record (masked)
  const pub = maskMobile(rec);
  const json = Buffer.from(JSON.stringify(pub), "utf8");
  const comp = brotliCompressSync(json);
  rawBytes += json.length; compBytes += comp.length;
  await recs.put(id, comp);

  // region index for range/prefix search: HARYANA/AMBALA/AMBALA/<id>
  const key = `${rec.state}/${rec.district}/${rec.block || rec.district}/${id}`;
  await region.put(key, id);

  // private encrypted record: real mobile
  if (rec.mobile) await privateBee.put(id, { census_id: id, mobile: rec.mobile });
}

console.log(`\nLoaded ${records.length} records`);
console.log(`Compression: ${rawBytes}B raw -> ${compBytes}B brotli (${(100 - 100*compBytes/rawBytes).toFixed(0)}% smaller)\n`);

// ---- 1) PUBLIC read = masked --------------------------------------------
const one = brotliDecompressSync(await recs.get("2904500").then(n => n.value));
const pubRec = JSON.parse(one.toString());
console.log("PUBLIC read weaver 2904500:");
console.log(`  name=${pubRec.name}  district=${pubRec.district}  social_group=${pubRec.social_group}`);
console.log(`  mobile(real)=${pubRec.mobile ?? "<<absent>>"}  mobile_masked=${pubRec.mobile_masked}`);

// ---- 2) AUTHORIZED read = real (from encrypted core) --------------------
const priv = await privateBee.get("2904500");
console.log(`\nAUTHORIZED read (encryption key present): real mobile = ${priv.value.mobile}`);

// ---- 3) SEARCH / CAPACITY via region range query ------------------------
console.log(`\nRANGE search — all weavers in HARYANA/AMBALA/AMBALA:`);
let count = 0;
for await (const { key, value } of region.createReadStream({
  gte: "HARYANA/AMBALA/AMBALA/", lt: "HARYANA/AMBALA/AMBALA/~",
})) { console.log(`  ${value}  (${key})`); count++; }
console.log(`  -> capacity count = ${count}`);

await publicCore.close(); await privateCore.close();
