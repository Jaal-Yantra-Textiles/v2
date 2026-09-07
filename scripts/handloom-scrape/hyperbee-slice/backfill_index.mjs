// One-shot: build the census PUBLIC-core secondary index over records that were
// seeded before idx emission existed. Run it ONCE (resumable) to unlock the
// reader's fast browse/traversal path across the multi-million sweep.
//
// The census core is single-writer, so the live seeder MUST be stopped while
// this runs (it holds the writer otherwise):
//
//   sudo systemctl stop handloom-seed
//   cd /opt/handloom/jyt/scripts/handloom-scrape/hyperbee-slice
//   P2P_STORE=/opt/handloom/p2p-store node backfill_index.mjs
//   sudo systemctl start handloom-seed
//
// It's resumable (checkpoints meta/idx-backfill-cursor) and idempotent (skips
// only when BOTH meta/idx-version AND meta/idx-all-version are set), so a
// Ctrl-C / crash just re-runs from the last checkpoint. Re-run it after adding a
// new index family (e.g. the whole-corpus `all` family) — it detects the missing
// flag, re-walks the corpus, and flips the Medusa reader onto that family
// automatically. On completion it sets both flags.

import Corestore from "corestore"
import Hyperbee from "hyperbee"
import { brotliDecompressSync, brotliCompressSync } from "node:zlib"

import { backfillIndex } from "./census_index.mjs"

const STORE_DIR = process.env.P2P_STORE || "./p2p-store"
const CORE_NAME = process.env.PUBLIC_CORE_NAME || "handloom-public-v1"

const SEP = Buffer.from([0])
const subKey = (name, k) => Buffer.concat([Buffer.from(name), SEP, Buffer.from(String(k))])
const decode = (buf) => JSON.parse(brotliDecompressSync(buf).toString())
// Encodes the lean inline display payload written onto every index value (the
// geo generation). Passing this flips backfillIndex into payload mode.
//
// OFF BY DEFAULT, and the reason is arithmetic, not taste. Measured against real
// prod records the payload is ~288 B, and a record now emits ~18 index families;
// across 3,587,570 records that is ~66M entries ≈ 20 GB in the core, ~28 GB once
// RocksDB has it. The seeder box (VM.Standard.E2.1.Micro, 45 GB boot volume) has
// 11 GB free. Keys-only is ~0.9 GB / ~1.3 GB on disk.
//
// It costs that much to save ONE rec/* seek per row during a scan — which mattered
// when a filtered browse drained a family to MAX_SCAN. It no longer does: every
// equality facet now carries its own `agg/eq/<field>/<value>` cell, so a browse is
// an O(1) count plus ONE PAGE of hydrates. The payload now saves ~20 seeks per
// request, for 27 GB. The reader handles empty values by design (decodeIndexRow
// falls back to rec/* when the buffer is empty), so a keys-only store — or a store
// with a mix — is correct, just one seek per displayed row.
//
// Set IDX_GEO=1 to opt in, on hardware that has the room.
const emitGeoPayload = process.env.IDX_GEO === "1"
const encodePayload = (obj) => brotliCompressSync(Buffer.from(JSON.stringify(obj)))

const store = new Corestore(STORE_DIR)
const core = store.get({ name: CORE_NAME })
await core.ready()

if (!core.writable) {
  console.error(
    `✗ core "${CORE_NAME}" in ${STORE_DIR} is NOT writable — is the seeder still running?\n` +
    `  Stop it first:  sudo systemctl stop handloom-seed`
  )
  await store.close()
  process.exit(1)
}

const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" })
await bee.ready()

console.log(
  `→ backfilling census index over "${CORE_NAME}" (${STORE_DIR}), core length=${core.length}, ` +
  `${emitGeoPayload ? "WITH inline geo payload (~288 B/entry — check free disk!)" : "keys only"}…`
)
const t0 = Date.now()
const { indexed, alreadyDone } = await backfillIndex(bee, {
  subKey,
  decode,
  ...(emitGeoPayload ? { encodePayload } : {}),
  batchSize: Number(process.env.IDX_BATCH || 5000),
  log: (m) => console.log(m),
})

if (alreadyDone) {
  console.log("✓ index already built (meta/idx-version set) — nothing to do.")
} else {
  console.log(`✅ indexed ${indexed} records in ${((Date.now() - t0) / 1000).toFixed(1)}s — idx-version set.`)
}

await store.close()
process.exit(0)
