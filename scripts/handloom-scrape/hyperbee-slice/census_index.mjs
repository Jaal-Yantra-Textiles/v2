// Census PUBLIC-core secondary index — makes browse/traversal viable across the
// multi-million sweep. Without it, listing weavers scans `rec/*` in memory
// (bounded to 50k) and TIMES OUT (504) once the corpus is large. With it, a
// filtered browse is an ORDERED range-scan over `idx/*` — O(page), not O(corpus)
// — and totals come from the existing `agg/*` cells in O(1).
//
// Index families (values line up 1:1 with agg dims, so counts stay exact):
//   idx/state/<state>/<pad10(id)>
//   idx/gender/<gender>/<pad10(id)>
//   idx/sd/<state>|<district>/<pad10(id)>
//   idx/all/<pad10(id)>                    (whole corpus, ordered by id — powers
//                                           the unfiltered map browse: O(page)
//                                           range-scan + O(1) `total/weavers`
//                                           count, no more O(corpus) rec/* scan)
//
// Ids are zero-padded to 10 digits so the lexicographic key order == numeric
// order (ids < 10^10). This MUST match the Medusa reader (census/reader.ts,
// ID_PAD = 10) that range-scans these keys.
//
// Two entry points the seeder wires in:
//   idxRelKeys(record)          → the sub-relative idx keys for a record; the
//                                 seeder puts subKey("idx", k) in its atomic batch
//                                 alongside rec/agg, so the index is crash-exact.
//   backfillIndex(bee, deps)    → one-time resumable pass that indexes records
//                                 already seeded before idx emission existed; sets
//                                 meta/idx-version when complete so the reader
//                                 flips from scan → index automatically.
//
//   node census_index.mjs --test   # self-verify emission + backfill on a scratch Hyperbee

import assert from "node:assert"

export const ID_PAD = 10
// Facet families (state/gender/sd) gate on IDX_VERSION; the whole-corpus `all`
// family gates on its own IDX_ALL_VERSION so the two roll out independently — the
// reader only uses `idx/all/*` once THIS backfill has emitted it (else it would
// range-scan an empty family). MUST match reader.ts FACET_IDX_META/ALL_IDX_META.
export const IDX_VERSION = "idx-v1"
export const IDX_ALL_VERSION = "idxall-v1"
// Name facet family (`idx/name/<normalized>/<pad10(id)>`) — added later than the
// others so it rolls out independently; MUST match reader.ts NAME_IDX_META.
export const IDX_NAME_VERSION = "idxname-v1"
// Equality facet families (`idx/<field>/<value>/<pad10(id)>` for each field in
// EQ_FIELDS) — added later, gated independently (reader.ts EQ_IDX_META). These
// are the remaining filterable equality dims that previously rode a residual
// O(corpus) scan. MUST match reader.ts EQ_FACETS (same set).
export const IDX_EQ_VERSION = "idxeq-v1"
// Filterable equality facets indexed beyond state/gender/sd. Exact-equality
// lookups (not prefix scans), so their values ride the key verbatim. Booleans
// are stringified ("true"/"false"). Values must not contain "/" (unlikely here).
// ORDER MATTERS: the reader drives its scan off the FIRST of these present in a
// query, so they run most-selective-first (a village family is thousands of rows,
// an electricity family is millions). MUST match reader.ts EQ_FACETS exactly —
// same members, same order (a unit test asserts it).
export const EQ_FIELDS = [
  "village", "block", "district", "education", "ownership_type",
  "household_type", "dwelling_type", "rural_urban",
  "own_looms", "natural_dye_used", "electricity",
]
// Equality-facet aggregate cells live at `agg/eq/<field>/<value>`. Namespaced
// under `eq/` so they never collide with the seeder's analytics dims (its
// `district/<state>|<district>` vs this `eq/district/<district>`) and so a fresh
// backfill can reset the whole group without touching them. These are what let
// the reader answer an equality-facet count in O(1) instead of draining the
// family to MAX_SCAN. MUST match reader.ts EQ_AGG_PREFIX.
export const EQ_AGG_PREFIX = "eq"
// Cursor generation. The backfill checkpoints under a cursor key carrying this
// suffix, so ADDING a family — which requires a fresh whole-corpus walk — starts
// from an absent key, while an interrupted run of the CURRENT generation still
// resumes from its checkpoint. Bump whenever the emitted family SET or the value
// format changes. (Before this existed, "a family is missing" was itself the
// reset rule, which meant every crash before completion restarted from zero —
// the one thing a multi-million-record walk cannot afford.)
export const IDX_CURSOR_GENERATION = "g2"
// Bumped when the index VALUE format changes. v1 stored empty values (keys only,
// so browse range-scanned the index for ids then hydrated each fat rec/* record);
// "geo-v1" stores an inline display payload in every family value so browse reads
// the small payload straight off the ordered scan — no random rec/* seek, no
// 125-field brotli inflate per row. The reader flips to the inline path only when
// meta/idx-geo-version is set. MUST match reader.ts GEO_IDX_META.
export const IDX_GEO_VERSION = "geo-v1"
export const padId = (id) => String(id).padStart(ID_PAD, "0")

// Normalise a weaver name into a facet value that is safe as a range-scanned key:
// lowercased, runs of anything that isn't a Unicode letter/digit collapsed to a
// single "_" (so no byte sorts below "/" 0x2f and breaks the `prefix/`→`prefix:`
// range). MUST match reader.ts `normalizeName` exactly or the index and the
// reader will compute different prefixes and never match.
export const normalizeName = (n) =>
  String(n ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "")

const EMPTY = Buffer.from("")

// The lean projection stored in each index value — exactly the fields the atlas
// map plots + shows in its side panel, and the equality-filterable facets. Chosen
// to exclude the fat `survey`/`products`/`schemes` bags (the reason a full-record
// hydrate is slow). Keep in sync with the map's WEAVER_META_KEYS.
const GEO_FIELDS = [
  "census_id", "village", "block", "district", "state", "gender", "age",
  "religion", "social_group", "education", "rural_urban", "household_type",
  "dwelling_type", "ownership_type", "electricity", "own_looms",
  "total_looms_owned", "pit_loom_count", "frame_loom_count", "natural_dye_used",
  "monthly_income", "handloom_income", "avg_production_meters", "intricacy_level",
]

/**
 * Build the inline display payload for a PUBLIC record: the lean typed fields
 * plus latitude/longitude. The scraper captures the source portal's coordinates
 * but the fast parser leaves them in the raw `survey` bag rather than promoting
 * them — so lift survey.{Latitude,Longitude} to typed lat/long here (this is what
 * finally puts weavers on the map). Only non-empty scalars are kept.
 */
export function geoPayload(r) {
  const out = {}
  for (const k of GEO_FIELDS) {
    const v = r[k]
    if (v != null && v !== "") out[k] = v
  }
  const sv = r.survey && typeof r.survey === "object" ? r.survey : null
  // Weaver names are public — promote to a typed field so the atlas can label
  // pins (the map already reads w.name). The fat survey bag is NOT carried in the
  // payload, so this is the only place the name survives into the fast browse path.
  const nm = r.name ?? sv?.Name ?? sv?.name
  if (typeof nm === "string" && nm.trim()) out.name = nm.trim()
  const lat = r.latitude ?? sv?.Latitude ?? sv?.latitude
  const lng = r.longitude ?? sv?.Longitude ?? sv?.longitude
  if (lat != null && lat !== "" && Number.isFinite(Number(lat))) out.latitude = Number(lat)
  if (lng != null && lng !== "" && Number.isFinite(Number(lng))) out.longitude = Number(lng)
  return out
}

/** Sub-relative idx keys for one PUBLIC record (skips families whose value is
 * null/empty so we never index a bogus "undefined" bucket). */
export function idxRelKeys(r) {
  if (r == null || r.census_id == null) return []
  const p = padId(r.census_id)
  const keys = []
  keys.push(`all/${p}`) // every record joins the whole-corpus ordered family
  if (r.state) keys.push(`state/${r.state}/${p}`)
  if (r.gender) keys.push(`gender/${r.gender}/${p}`)
  if (r.state && r.district) keys.push(`sd/${r.state}|${r.district}/${p}`)
  // equality facets — exact-equality families. Skip null/empty; booleans are
  // emitted for both true and false (so `own_looms=false` is filterable).
  for (const f of EQ_FIELDS) {
    const v = r[f]
    if (v === null || v === undefined || v === "") continue
    keys.push(`${f}/${String(v)}/${p}`)
  }
  // name facet — the free-text search family. Name lives at top level (promoted
  // by the parser) or inside the raw survey bag, exactly as geoPayload resolves it.
  const nm = r.name ?? r.survey?.Name ?? r.survey?.name
  if (typeof nm === "string" && nm.trim()) {
    const n = normalizeName(nm)
    // The full normalized name AND each token. A prefix range-scan over the full
    // name alone finds "Mustaq Ahmed" for `mustaq` but NOT "Abdul Mustaq" — a
    // silent zero-row answer where the old substring scan was merely slow. One
    // key per token fixes that for ~2 extra keys a record. A record can therefore
    // appear under several name keys for one query, so the READER dedupes by id.
    for (const t of new Set(n ? [n, ...n.split("_")] : [])) {
      if (t) keys.push(`name/${t}/${p}`)
    }
  }
  return keys
}

/** Equality-facet aggregate cells for one record — `eq/<field>/<value>`, one per
 * populated facet. Emitted by BOTH the backfill and the seeder's incremental
 * ingest so the counts stay exact as the corpus grows. */
export function eqAggKeys(r) {
  const keys = []
  if (r == null) return keys
  for (const f of EQ_FIELDS) {
    const v = r[f]
    if (v === null || v === undefined || v === "") continue
    keys.push(`${EQ_AGG_PREFIX}/${f}/${String(v)}`)
  }
  return keys
}

/**
 * Resumable backfill: walk `rec/*`, decode each record, and write its idx keys.
 * Progress is checkpointed in `meta/idx-backfill-cursor` (the last rec key done),
 * so a crash/restart resumes instead of redoing the whole corpus. Batches are
 * flushed every `batchSize` records to bound memory + make progress durable.
 * On completion sets `meta/idx-version` + `meta/idx-all-version`, the flags the
 * reader checks to flip each family from scan → index. Re-runs if either flag is
 * missing (e.g. an older run that predates the `all` family), so bumping a
 * family is just "add the keys in idxRelKeys + re-run this backfill".
 *
 * deps: { subKey(name, key)->Buffer, decode(buf)->record, batchSize?, log? }
 * Returns { indexed, alreadyDone }.
 */
export async function backfillIndex(bee, { subKey, decode, encodePayload, batchSize = 5000, log = () => {} }) {
  const meta = bee.sub("meta", { valueEncoding: "utf-8" })
  const facetsDone = (await meta.get("idx-version"))?.value === IDX_VERSION
  const allDone = (await meta.get("idx-all-version"))?.value === IDX_ALL_VERSION
  const nameDone = (await meta.get("idx-name-version"))?.value === IDX_NAME_VERSION
  const eqDone = (await meta.get("idx-eq-version"))?.value === IDX_EQ_VERSION
  // Only emit inline payloads when the caller wired an encoder; without it we
  // preserve the legacy keys-only behaviour (empty values) for old callers.
  const emitGeo = typeof encodePayload === "function"
  const geoDone = (await meta.get("idx-geo-version"))?.value === IDX_GEO_VERSION
  if (facetsDone && allDone && nameDone && eqDone && (!emitGeo || geoDone)) {
    return { indexed: 0, alreadyDone: true }
  }

  // A new family SET (or a new value format) has to re-walk the whole corpus — a
  // cursor from the previous generation is parked at the end and would emit
  // nothing. That is expressed as the cursor KEY carrying the generation, so a
  // fresh walk starts from an absent key while an interrupted run of THIS
  // generation resumes from its own checkpoint. Geo and legacy (keys-only) runs
  // keep separate cursors because they write different values. Puts are
  // idempotent overwrites, so re-emitting keys is always harmless.
  const CURSOR = `${emitGeo ? "idx-geo-cursor" : "idx-backfill-cursor"}-${IDX_CURSOR_GENERATION}`
  const cursorNode = await meta.get(CURSOR)
  let resumeAfter = cursorNode ? cursorNode.value : null

  const rec = bee.sub("rec", { valueEncoding: "binary" })
  const aggSub = bee.sub("agg", { valueEncoding: "utf-8" })

  if (resumeAfter == null) {
    // A fresh whole-corpus walk counts every record again, so eq cells left by a
    // previous generation (or by a run that was reset) would double-count. Clear
    // ONLY the `eq/*` group — the seeder's analytics dims share this sub. "0"
    // (0x30) is the first byte above "/" (0x2f), so it upper-bounds the prefix.
    const stale = []
    for await (const { key } of aggSub.createReadStream({ gte: `${EQ_AGG_PREFIX}/`, lt: `${EQ_AGG_PREFIX}0` })) stale.push(key)
    for (const k of stale) await aggSub.del(k)
    if (stale.length) log(`[idx-backfill] cleared ${stale.length} stale ${EQ_AGG_PREFIX}/* agg cells before a fresh walk`)
  }

  // rec sub keys are the unpadded census_id strings; resume strictly after the
  // last processed key (Hyperbee streams in key order).
  const range = resumeAfter != null ? { gt: resumeAfter } : {}

  let indexed = 0
  let pending = [] // [relKey, valueBuffer]
  let aggDelta = new Map() // eq agg key -> count within THIS batch
  let lastKey = resumeAfter

  const flush = async () => {
    if (pending.length === 0 && aggDelta.size === 0) return
    // Fold this batch's equality-facet counts into the stored cells BEFORE opening
    // the batch (single writer → no race), so the counts land atomically with the
    // records they came from AND the cursor that will skip those records on
    // resume — a crash can neither double-count nor lose a count.
    const newAgg = []
    for (const [k, d] of aggDelta) {
      const cur = await aggSub.get(k)
      newAgg.push([k, (cur ? Number(cur.value) : 0) + d])
    }
    const batch = bee.batch({ keyEncoding: "binary", valueEncoding: "binary" })
    for (const [relKey, val] of pending) await batch.put(subKey("idx", relKey), val)
    for (const [k, v] of newAgg) await batch.put(subKey("agg", k), Buffer.from(String(v)))
    // checkpoint the cursor in the SAME batch → backfill is itself crash-exact.
    if (lastKey != null) await batch.put(subKey("meta", CURSOR), Buffer.from(String(lastKey)))
    await batch.flush()
    pending = []
    aggDelta = new Map()
  }

  let sinceFlush = 0
  for await (const { key, value } of rec.createReadStream(range)) {
    lastKey = key
    let record
    try {
      record = decode(value)
    } catch {
      continue // torn/corrupt row — skip, don't abort the whole backfill
    }
    const val = emitGeo ? encodePayload(geoPayload(record)) : EMPTY
    for (const rk of idxRelKeys(record)) pending.push([rk, val])
    for (const ak of eqAggKeys(record)) aggDelta.set(ak, (aggDelta.get(ak) || 0) + 1)
    indexed++
    if (++sinceFlush >= batchSize) {
      await flush()
      sinceFlush = 0
      log(`[idx-backfill] indexed ${indexed} records (cursor=${lastKey})`)
    }
  }
  await flush()

  await meta.put("idx-version", IDX_VERSION)
  await meta.put("idx-all-version", IDX_ALL_VERSION)
  await meta.put("idx-name-version", IDX_NAME_VERSION)
  await meta.put("idx-eq-version", IDX_EQ_VERSION)
  if (emitGeo) await meta.put("idx-geo-version", IDX_GEO_VERSION)
  log(`[idx-backfill] DONE — ${indexed} records indexed, idx-version=${IDX_VERSION}, idx-all-version=${IDX_ALL_VERSION}, idx-name-version=${IDX_NAME_VERSION}, idx-eq-version=${IDX_EQ_VERSION}${emitGeo ? `, idx-geo-version=${IDX_GEO_VERSION}` : ""}`)
  return { indexed, alreadyDone: false }
}

// ── self-test: verify emission + backfill + range query on a scratch Hyperbee ──
// Guard on being the MAIN module — else this fires whenever an importer (e.g.
// apply_repairs) is run with --test.
const { fileURLToPath: _f } = await import("node:url")
const _isMain = process.argv[1] && _f(import.meta.url) === process.argv[1]
if (_isMain && process.argv.includes("--test")) {
  const { default: Corestore } = await import("corestore")
  const { default: Hyperbee } = await import("hyperbee")
  const b4a = (await import("b4a")).default
  const { brotliCompressSync, brotliDecompressSync } = await import("node:zlib")
  const { rmSync } = await import("node:fs")

  const DIR = "./.idx-selftest-store"
  rmSync(DIR, { recursive: true, force: true })
  const store = new Corestore(DIR)
  const core = store.get({ name: "idx-selftest" })
  await core.ready()
  const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" })
  await bee.ready()

  const SEP = Buffer.from([0])
  const subKey = (name, k) => Buffer.concat([Buffer.from(name), SEP, Buffer.from(String(k))])
  const decode = (buf) => JSON.parse(brotliDecompressSync(buf).toString())
  const enc = (r) => brotliCompressSync(Buffer.from(JSON.stringify(r)))
  const encodePayload = (obj) => brotliCompressSync(Buffer.from(JSON.stringify(obj)))

  const records = [
    // id 10 carries coords in the raw survey bag (as the fast parser leaves them)
    // → the payload must promote them to typed lat/long.
    { census_id: 10, state: "KARNATAKA", district: "BAGALKOT", gender: "Male", village: "ILKAL", education: "Middle", own_looms: true, survey: { Name: "SHANTAVVA", Latitude: "16.1329", Longitude: "75.9587" } },
    { census_id: 11, state: "KARNATAKA", district: "BAGALKOT", gender: "Female", education: "Middle", own_looms: false },
    { census_id: 12, state: "KARNATAKA", district: "BELGAUM", gender: "Male", education: "High", own_looms: true, survey: { Name: "ABDUL MUSTAQ" } },
    { census_id: 13, state: "PUNJAB", district: "AMRITSAR", gender: "Female" },
    { census_id: 14, state: "KARNATAKA", district: "BAGALKOT", gender: "Male" },
  ]

  // seed rec/* WITHOUT idx (simulating pre-index data), then backfill.
  const b1 = bee.batch({ keyEncoding: "binary", valueEncoding: "binary" })
  for (const r of records) await b1.put(subKey("rec", r.census_id), enc(r))
  await b1.flush()

  let pass = 0
  const ok = (l, c) => { assert(c, `FAIL: ${l}`); console.log(`  ✓ ${l}`); pass++ }

  const res = await backfillIndex(bee, { subKey, decode, encodePayload, batchSize: 2 })
  ok("backfill reports all records indexed", res.indexed === 5)
  ok("idx-version flag set", (await bee.sub("meta", { valueEncoding: "utf-8" }).get("idx-version"))?.value === "idx-v1")
  ok("idx-all-version flag set", (await bee.sub("meta", { valueEncoding: "utf-8" }).get("idx-all-version"))?.value === "idxall-v1")
  ok("idx-geo-version flag set", (await bee.sub("meta", { valueEncoding: "utf-8" }).get("idx-geo-version"))?.value === "geo-v1")
  ok("idx-name-version flag set", (await bee.sub("meta", { valueEncoding: "utf-8" }).get("idx-name-version"))?.value === "idxname-v1")
  ok("idx-eq-version flag set", (await bee.sub("meta", { valueEncoding: "utf-8" }).get("idx-eq-version"))?.value === "idxeq-v1")

  // whole-corpus `all` family → every id, ascending (powers the unfiltered browse).
  const idxAll = bee.sub("idx", { valueEncoding: "binary" })
  const all = []
  let payload10 = null
  for await (const { key, value } of idxAll.createReadStream({ gte: "all/", lt: "all/:" })) {
    const id = Number(key.slice("all/".length))
    all.push(id)
    if (id === 10) payload10 = decode(value) // inline payload rides the value now
  }
  ok("all index returns every id, sorted", JSON.stringify(all) === JSON.stringify([10, 11, 12, 13, 14]))
  ok("inline payload carries the lean fields", payload10 && payload10.state === "KARNATAKA" && payload10.village === "ILKAL")
  ok("payload promotes survey coords to typed lat/long", payload10 && payload10.latitude === 16.1329 && payload10.longitude === 75.9587)
  ok("payload promotes survey Name to a public typed field", payload10 && payload10.name === "SHANTAVVA")
  ok("payload omits the fat survey bag", payload10 && payload10.survey === undefined)

  // range-scan the KARNATAKA state facet → ids in ascending order.
  const idx = bee.sub("idx", { valueEncoding: "binary" })
  const prefix = "state/KARNATAKA/"
  const got = []
  for await (const { key } of idx.createReadStream({ gte: prefix, lt: `${prefix}:` })) {
    got.push(Number(key.slice(prefix.length)))
  }
  ok("state index returns exactly the KARNATAKA ids, sorted", JSON.stringify(got) === JSON.stringify([10, 11, 12, 14]))

  // state|district drill-down.
  const sdPrefix = "sd/KARNATAKA|BAGALKOT/"
  const sd = []
  for await (const { key } of idx.createReadStream({ gte: sdPrefix, lt: `${sdPrefix}:` })) {
    sd.push(Number(key.slice(sdPrefix.length)))
  }
  ok("state|district index returns the BAGALKOT ids", JSON.stringify(sd) === JSON.stringify([10, 11, 14]))

  // cursor: after id 11 within KARNATAKA → 12, 14.
  const after = []
  for await (const { key } of idx.createReadStream({ gt: `${prefix}${padId(11)}`, lt: `${prefix}:` })) {
    after.push(Number(key.slice(prefix.length)))
  }
  ok("cursor (after=11) yields the next ids", JSON.stringify(after) === JSON.stringify([12, 14]))

  // name facet — the reader range-scans the NAME part with a "\uffff" upper bound
  // (not the id-suffix ":" bound used by state/gender/sd), so both exact and
  // prefix queries resolve by scanning `name/<query>` → `name/<query>\uffff`.
  const nameExact = []
  for await (const { key } of idx.createReadStream({ gte: "name/shantavva", lt: "name/shantavva\uffff" })) {
    nameExact.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("name index returns the SHANTAVVA id (exact)", JSON.stringify(nameExact) === JSON.stringify([10]))
  const namePrefixIds = []
  for await (const { key } of idx.createReadStream({ gte: "name/shant", lt: "name/shant\uffff" })) {
    namePrefixIds.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("name index supports a prefix range scan", JSON.stringify(namePrefixIds) === JSON.stringify([10]))
  // a NON-leading token must be findable — the whole point of emitting tokens.
  const nameToken = []
  for await (const { key } of idx.createReadStream({ gte: "name/mustaq", lt: "name/mustaq\uffff" })) {
    nameToken.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("name index finds a record by a NON-leading token", JSON.stringify(nameToken) === JSON.stringify([12]))
  const nameFull = []
  for await (const { key } of idx.createReadStream({ gte: "name/abdul_mustaq", lt: "name/abdul_mustaq\uffff" })) {
    nameFull.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("name index still answers the full multi-word name", JSON.stringify(nameFull) === JSON.stringify([12]))

  // equality facets — exact-equality lookups (same ":" id-suffix bound as state/gender).
  const eqEducation = []
  for await (const { key } of idx.createReadStream({ gte: "education/Middle/", lt: "education/Middle:" })) {
    eqEducation.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("education facet returns the 'Middle' ids", JSON.stringify(eqEducation) === JSON.stringify([10, 11]))
  const eqOwnTrue = []
  for await (const { key } of idx.createReadStream({ gte: "own_looms/true/", lt: "own_looms/true:" })) {
    eqOwnTrue.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("own_looms=true facet returns loom owners", JSON.stringify(eqOwnTrue) === JSON.stringify([10, 12]))
  const eqOwnFalse = []
  for await (const { key } of idx.createReadStream({ gte: "own_looms/false/", lt: "own_looms/false:" })) {
    eqOwnFalse.push(Number(key.slice(key.lastIndexOf("/") + 1)))
  }
  ok("own_looms=false facet returns non-owners", JSON.stringify(eqOwnFalse) === JSON.stringify([11]))

  // equality-facet AGG cells — what makes an eq-facet count O(1) instead of a
  // drain to MAX_SCAN. Namespaced under `eq/` so they never collide with the
  // seeder's own `district/<state>|<district>` analytics dim.
  const aggS = bee.sub("agg", { valueEncoding: "utf-8" })
  const aggN = async (k) => Number((await aggS.get(k))?.value ?? -1)
  ok("eq agg counts the education family", (await aggN("eq/education/Middle")) === 2)
  ok("eq agg counts a boolean facet", (await aggN("eq/own_looms/true")) === 2 && (await aggN("eq/own_looms/false")) === 1)
  ok("eq agg is namespaced under eq/", (await aggN("eq/district/BAGALKOT")) === 3 && (await aggN("district/BAGALKOT")) === -1)

  // idempotent: a second backfill is a no-op.
  const again = await backfillIndex(bee, { subKey, decode })
  ok("second backfill is a no-op (already done)", again.alreadyDone === true)

  // forward emission helper — record 10: all + state + gender + sd + 4 eq (district, village, education, own_looms) + name = 9.
  ok("idxRelKeys emits 9 families for a full named record", idxRelKeys(records[0]).length === 9)
  ok("idxRelKeys skips district+name+eq families when missing", idxRelKeys({ census_id: 9, state: "GOA", gender: "Male" }).length === 3)
  ok("idxRelKeys still emits the all family for a bare record", idxRelKeys({ census_id: 9 }).length === 1 && idxRelKeys({ census_id: 9 })[0] === "all/0000000009")

  await store.close()

  // ── resumability: a run interrupted BEFORE its completion flags are set must
  // resume from its checkpoint, not restart the corpus. On a 3.5M-record walk
  // with the seeder stopped, a restart-from-zero is the difference between a
  // recoverable crash and a lost window.
  const DIR2 = "./.idx-selftest-resume"
  rmSync(DIR2, { recursive: true, force: true })
  const store2 = new Corestore(DIR2)
  const core2 = store2.get({ name: "idx-resume" })
  await core2.ready()
  const bee2 = new Hyperbee(core2, { keyEncoding: "utf-8", valueEncoding: "binary" })
  await bee2.ready()
  const rec2 = bee2.sub("rec", { valueEncoding: "binary" })
  for (let i = 1; i <= 40; i++) {
    await rec2.put(String(i).padStart(10, "0"), enc({ census_id: i, state: "GOA", gender: "Male", education: "Middle", name: "Weaver " + i }))
  }
  const meta2 = bee2.sub("meta", { valueEncoding: "utf-8" })
  // a previous generation completed; this generation's run then died at record 30.
  await meta2.put("idx-version", IDX_VERSION)
  await meta2.put("idx-all-version", IDX_ALL_VERSION)
  await meta2.put("idx-geo-version", IDX_GEO_VERSION)
  await meta2.put(`idx-geo-cursor-${IDX_CURSOR_GENERATION}`, String(30).padStart(10, "0"))
  const resumed = await backfillIndex(bee2, { subKey, decode, encodePayload, batchSize: 5, log: () => {} })
  ok("an interrupted backfill resumes from its checkpoint", resumed.indexed === 10)

  // a genuinely new generation has no cursor of its own → it re-walks everything.
  await meta2.del("idx-name-version")
  await meta2.del("idx-eq-version")
  await meta2.del(`idx-geo-cursor-${IDX_CURSOR_GENERATION}`)
  const fresh = await backfillIndex(bee2, { subKey, decode, encodePayload, batchSize: 5, log: () => {} })
  ok("a new family generation re-walks the whole corpus", fresh.indexed === 40)
  // and that re-walk must not double-count the eq cells it already wrote.
  const agg2 = bee2.sub("agg", { valueEncoding: "utf-8" })
  ok("a re-walk resets eq agg instead of double-counting", Number((await agg2.get("eq/education/Middle"))?.value) === 40)

  await store2.close()
  rmSync(DIR2, { recursive: true, force: true })
  rmSync(DIR, { recursive: true, force: true })
  console.log(`\n✅ ${pass}/${pass} — census index emission + resumable backfill + range query hold.`)
  process.exit(0)
}
