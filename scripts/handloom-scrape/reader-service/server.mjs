// Handloom census EDGE READER — a tiny always-on HTTP service that holds the
// Hyperswarm peer so clients that can't (or shouldn't) peer in-process — e.g.
// Medusa on Fargate — can read census data over plain HTTPS.
//
// It replicates the PUBLIC core BY KEY (read-only, no encryption key → never any
// PII), opens a Hyperbee, and serves the same shapes the Medusa census module's
// proxy mode expects:
//   GET /health                                  → liveness + replication state
//   GET /census/stats?minCell=5                  → { stats }  (k-anon aggregates)
//   GET /census/weavers?state=…&limit=&offset=   → { weavers, count, capped, limit, offset }
//   GET /census/weavers/:census_id               → { weaver }  (masked; null if unknown)
//
//   CENSUS_PUBLIC_CORE_KEY=<hex>  PORT=<n>  [CENSUS_P2P_STORE=./store]  node server.mjs
//
// Deploy target: Render (see render.yaml). Different network from the OCI seeder,
// so Hyperswarm DHT hole-punching works (unlike the same-cloud mirror that needed
// a direct socket). Point Medusa at it with CENSUS_READER_URL=https://…onrender.com

import http from "node:http"
import Corestore from "corestore"
import Hyperbee from "hyperbee"
import Hyperswarm from "hyperswarm"
import b4a from "b4a"
import { brotliDecompressSync } from "node:zlib"

const PORT = Number(process.env.PORT || 8080)
const STORE_DIR = process.env.CENSUS_P2P_STORE || "./census-reader-store"
const PUBLIC_KEY = (
  process.env.CENSUS_PUBLIC_CORE_KEY ||
  "5709e2edba5a83ca3711d84c049217f202c6101f2554b2c54f41498ba5ff35da"
).trim()
const MIN_CELL = 5
const MAX_SCAN = 50_000

// ── connect: replicate the public core by key, keep pulling appends ──────────
const store = new Corestore(STORE_DIR)
await store.ready()
const core = store.get({ key: b4a.from(PUBLIC_KEY, "hex") })
await core.ready()

const swarm = new Hyperswarm()
swarm.on("connection", (conn) => store.replicate(conn))
const done = core.findingPeers()
swarm.join(core.discoveryKey, { server: false, client: true })
swarm.flush().then(done, done)
core.download({ start: 0, end: -1 })
core.on("append", () => core.download({ start: 0, end: core.length }))

const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" })
await bee.ready()

const decode = (buf) => JSON.parse(brotliDecompressSync(buf).toString())

// ── queries (same semantics as the Medusa CensusReader) ─────────────────────
async function getStats(minCell) {
  const agg = bee.sub("agg", { valueEncoding: "utf-8" })
  const dims = {}
  for await (const { key, value } of agg.createReadStream()) {
    const [dim, ...rest] = key.split("/")
    const count = Number(value)
    ;(dims[dim] ??= {})[rest.join("/")] =
      dim === "total" || dim === "loom_type" ? count : count < minCell ? null : count
  }
  return dims
}

async function retrieveWeaver(id) {
  const node = await bee.sub("rec", { valueEncoding: "binary" }).get(String(id))
  return node ? decode(node.value) : null
}

async function listAndCountWeavers(filters, limit, offset, after) {
  const rec = bee.sub("rec", { valueEncoding: "binary" })
  const entries = Object.entries(filters)

  // Unfiltered browse (the public map's hot path): page the ordered rec/* store
  // and stop once the page window is filled — O(offset+limit), never a full
  // scan. The grand total comes from the agg/total/weavers cell in O(1).
  // Previously EVERY request decompressed up to MAX_SCAN records just to count
  // them, which blows past request timeouts under the multi-million sweep.
  if (entries.length === 0) {
    // rec sub keys are the unpadded census_id strings; Hyperbee streams in key
    // order. With a cursor, resume strictly past the last id of the prior page.
    const range = after != null ? { gt: String(after) } : {}
    const weavers = []
    let skipped = 0
    let next = null
    for await (const { key, value } of rec.createReadStream(range)) {
      if (after == null && skipped < offset) {
        skipped++
        continue
      }
      weavers.push(decode(value))
      next = String(key)
      if (weavers.length >= limit) break // page filled — stop, no corpus scan
    }
    const totalNode = await bee.sub("agg", { valueEncoding: "utf-8" }).get("total/weavers")
    const count = totalNode ? Number(totalNode.value) : weavers.length
    return { weavers, count, capped: false, next }
  }

  // Filtered: an accurate count requires visiting every match, so do the
  // bounded in-memory scan (MAX_SCAN caps worst-case work; `capped` flags it).
  const match = (r) => entries.every(([k, v]) => String(r[k]) === String(v))
  const weavers = []
  let count = 0
  let scanned = 0
  let capped = false
  for await (const { value } of rec.createReadStream()) {
    if (++scanned > MAX_SCAN) {
      capped = true
      break
    }
    const r = decode(value)
    if (!match(r)) continue
    if (count >= offset && weavers.length < limit) weavers.push(r)
    count++
  }
  return { weavers, count, capped }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const FILTERABLE = new Set([
  "state", "district", "block", "village", "gender", "rural_urban",
  "own_looms", "natural_dye_used", "education", "ownership_type",
  "household_type", "dwelling_type", "electricity",
])

const send = (res, status, body) => {
  const json = JSON.stringify(body)
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" })
  res.end(json)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x")
    const p = url.pathname

    if (p === "/health") {
      return send(res, 200, {
        ok: true,
        connected: core.length > 0,
        peers: swarm.connections.size,
        coreLength: core.length,
        contiguous: core.contiguousLength,
      })
    }

    if (p === "/census/stats") {
      const minCell = Number(url.searchParams.get("minCell")) || MIN_CELL
      return send(res, 200, { stats: await getStats(minCell) })
    }

    const byId = p.match(/^\/census\/weavers\/(.+)$/)
    if (byId) {
      return send(res, 200, { weaver: await retrieveWeaver(decodeURIComponent(byId[1])) })
    }

    if (p === "/census/weavers") {
      const filters = {}
      for (const [k, v] of url.searchParams) if (FILTERABLE.has(k) && v !== "") filters[k] = v
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100)
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0)
      // Opaque forward cursor (last census_id of the previous page) — keeps
      // deep pagination O(page) instead of degrading with offset.
      const afterParam = url.searchParams.get("after")
      const after = afterParam !== null && afterParam !== "" ? afterParam : undefined
      const out = await listAndCountWeavers(filters, limit, offset, after)
      return send(res, 200, { ...out, limit, offset })
    }

    return send(res, 404, { message: "not found" })
  } catch (e) {
    return send(res, 500, { message: e?.message || String(e) })
  }
})

server.listen(PORT, "0.0.0.0", () =>
  console.log(`[census-reader] listening :${PORT} — replicating public core ${PUBLIC_KEY.slice(0, 12)}… (read-only, PII-free)`)
)
