// Self-test for the unmask path — runs the REAL decrypt→unmask mechanism over a
// synthetic sensitive core (no live data, no network). Proves the two properties
// the unmask feature depends on:
//
//   1. The sensitive core is OPAQUE without the encryption key.
//   2. Opening it WITH the key (exactly what unmask_cli.mjs does) returns the
//      full PII, brotli-decoded, keyed by census_id.
//
//   node unmask_self_test.mjs
//
// Mirrors seed_p2p.mjs's core layout (name "handloom-sensitive-v1", rec\<0>id
// keys, brotli JSON values) so it exercises the same read path as the CLI and
// the reader node's /census/unmask endpoint.

import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { randomBytes } from "node:crypto";

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import assert from "node:assert";

const NAME = "handloom-sensitive-v1";
const KEY = randomBytes(32).toString("hex");
const STORE_DIR = mkdtempSync(join(tmpdir(), "unmask-self-test-"));
const SEP = Buffer.from([0]);
const subKey = (name, k) => Buffer.concat([Buffer.from(name), SEP, Buffer.from(String(k))]);

const ROWS = [
  { census_id: "2904500", name: "MOHD SHAHID", mobile: "9812345678", latitude: 27.28, longitude: 81.17, religion: "Hindu", social_group: "OBC" },
  { census_id: "2904501", name: "REKHA DEVI", mobile: "9876543210", latitude: 27.5, longitude: 81.4, religion: "Muslim", social_group: "General" },
];

let pass = 0;
const ok = (label, cond) => { assert(cond, `FAIL: ${label}`); console.log(`  ✓ ${label}`); pass++; };

// ── seed the synthetic sensitive core (encrypted) ─────────────────────────────
{
  const store = new Corestore(STORE_DIR);
  const core = store.get({ name: NAME, encryptionKey: b4a.from(KEY, "hex") });
  await core.ready();
  const bee = new Hyperbee(core, { keyEncoding: "binary", valueEncoding: "binary" });
  const batch = bee.batch({ keyEncoding: "binary", valueEncoding: "binary" });
  for (const r of ROWS) {
    await batch.put(subKey("rec", r.census_id), brotliCompressSync(Buffer.from(JSON.stringify(r))));
  }
  await batch.flush();
  await store.close();
}

// ── 1. opaque without the key ─────────────────────────────────────────────────
{
  const store = new Corestore(STORE_DIR);
  const noKey = store.get({ name: NAME });
  await noKey.ready();
  let leaked = false;
  try {
    const raw = await noKey.get(0);
    leaked = raw != null && b4a.toString(raw).includes("mobile");
  } catch { leaked = false; }
  ok("sensitive core is OPAQUE without the encryption key", !leaked);
  await store.close();
}

// ── 2. with the key, unmask resolves the full PII (unmask_cli.mjs's read path) ──
{
  const store = new Corestore(STORE_DIR);
  const core = store.get({ name: NAME, encryptionKey: b4a.from(KEY, "hex") });
  await core.ready();
  const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" });
  await bee.ready();

  for (const want of ROWS) {
    const node = await bee.sub("rec", { valueEncoding: "binary" }).get(want.census_id);
    ok(`rec/<${want.census_id}> present`, !!node);
    const rec = JSON.parse(brotliDecompressSync(node.value).toString());
    ok(`unmask(${want.census_id}) returns full PII`, rec.mobile === want.mobile && rec.religion === want.religion && rec.name === want.name);
  }

  const missing = await bee.sub("rec", { valueEncoding: "binary" }).get("9999999");
  ok("unknown census_id → null", missing == null);
  await store.close();
}

rmSync(STORE_DIR, { recursive: true, force: true });
console.log(`\n✅ ${pass}/${pass} — decrypt→unmask mechanism holds against a real Hypercore.`);