// Census reader NODE — durability replica + fast read surface, in ONE process.
//
// A superset of replicate_peer.mjs: it still joins the Hyperswarm and persists
// every block of the public + sensitive cores to disk (the blind-mirror
// durability role), and ADDITIONALLY opens a Hyperbee over the PUBLIC core and
// serves the census read API over localhost HTTP. Fronted by a Cloudflare Tunnel,
// prod Medusa reads census via CENSUS_READER_URL → this node — so the API tasks
// hold NO P2P store and never re-download the core on deploy (#1031/#1087 #2).
//
// One process owns the store: no second replica in RAM, no concurrent-corestore
// corruption. Reads are LOCAL disk seeks (the whole core is on disk here), so the
// remote-RTT N+1 that made the embedded reader slow is gone; the bundled reader
// still parallelizes hydration + LRU-caches decodes.
//
//   PUBLIC_CORE_KEY=<hex> SENSITIVE_CORE_KEY=<hex> [P2P_STORE=./replica-store] \
//   [CENSUS_NODE_PORT=8791] [SEED_HOST=<ip> SEED_PORT=49737] node census_reader_node.mjs
//
// Read surface (matches the CENSUS_READER_URL proxy contract in reader.ts):
//   GET /health
//   GET /census/stats?minCell=N        → { stats }
//   GET /census/weavers?<filters>&limit&offset&after → { weavers, count, ... }
//   GET /census/weavers/:id            → { weaver }
// Public, PII-free data → no auth (the proxy sends none).

import { createServer } from "node:http";

import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Hyperbee from "hyperbee";
import b4a from "b4a";

import { CensusReader } from "./census-reader.mjs";

const STORE_DIR = process.env.P2P_STORE || "./replica-store";
const PORT = Number(process.env.CENSUS_NODE_PORT || 8791);
const keys = [process.env.PUBLIC_CORE_KEY, process.env.SENSITIVE_CORE_KEY,
  ...(process.env.EXTRA_CORE_KEYS ? process.env.EXTRA_CORE_KEYS.split(",") : [])]
  .map((k) => (k || "").trim()).filter(Boolean);

if (!keys.length) {
  console.error("set PUBLIC_CORE_KEY (64-hex) — SENSITIVE_CORE_KEY optional for durability parity");
  process.exit(2);
}

const store = new Corestore(STORE_DIR);
await store.ready();

// read-only replicas of each core (no encryptionKey → sensitive stays opaque)
const cores = keys.map((hex) => store.get({ key: b4a.from(hex, "hex") }));
await Promise.all(cores.map((c) => c.ready()));
const publicCore = cores[0];

const swarm = new Hyperswarm();
swarm.on("connection", (conn) => {
  store.replicate(conn);
  console.log(`[${new Date().toISOString()}] peer connected — ${swarm.connections.size} active`);
  conn.on("close", () => console.log(`[${new Date().toISOString()}] peer disconnected — ${swarm.connections.size} active`));
});

for (const core of cores) {
  const done = core.findingPeers();
  swarm.join(core.discoveryKey, { server: false, client: true });
  swarm.flush().then(done, done);
  core.download({ start: 0, end: -1 });
  core.on("append", () => {
    core.download({ start: 0, end: core.length });
    console.log(`[${new Date().toISOString()}] mirror: ${core.key.toString("hex").slice(0, 12)}… grew → ${core.length} blocks`);
  });
}

// Catch-up: the initial download({start:0,end:-1}) only covers the length known
// at call time, and `append` fires only for FUTURE growth — so a peer that
// reconnects after the seeder already grew (e.g. an index re-backfill jumped the
// core from 3.26M→10M) can sit frozen at its old contiguous frontier. Re-learn the
// length and explicitly re-request any missing tail on an interval until closed.
//
// download({start,end}) proved unreliable for this: it waits for the peer to
// ADVERTISE the range in its bitfield, and after a big re-backfill the seeder can
// under-advertise the tail → the range request never completes and the frontier
// stays frozen (observed 2026-07-18: stuck at 3,510,134 while the seeder had 10.2M;
// only a get()-driven mop-up filled it). get(i, {wait:true}) forces an explicit
// per-block request that doesn't depend on the bitfield advertisement, so it can't
// stall the same way. Fill the missing tail in bounded-concurrency batches (blocks
// we already have return instantly from disk; we only pay for the true gap).
const CATCHUP_CONCURRENCY = Number(process.env.CATCHUP_CONCURRENCY || 128);
let catchUpRunning = false;
const catchUp = async () => {
  if (catchUpRunning) return; // don't stack sweeps while a big tail is still filling
  catchUpRunning = true;
  try {
    for (const core of cores) {
      try {
        await core.update();
        let i = core.contiguousLength;
        const target = core.length;
        if (i >= target) continue;
        console.log(`[${new Date().toISOString()}] catch-up: ${core.key.toString("hex").slice(0, 12)}… filling ${i}→${target} (${target - i} blocks)`);
        while (i < target) {
          const end = Math.min(i + CATCHUP_CONCURRENCY, target);
          const batch = [];
          for (let j = i; j < end; j++) batch.push(core.get(j, { wait: true }).catch(() => {}));
          await Promise.all(batch);
          i = end;
        }
      } catch (e) {
        console.log(`[${new Date().toISOString()}] catch-up error: ${e?.message || e}`);
      }
    }
  } finally {
    catchUpRunning = false;
  }
};
catchUp();
setInterval(catchUp, 15000);

// Direct-socket path for same-VCN peers (deterministic; avoids NAT hole-punch).
if (process.env.SEED_HOST) {
  const net = await import("node:net");
  const port = Number(process.env.SEED_PORT || 49737);
  const dial = () => {
    const socket = net.connect(port, process.env.SEED_HOST);
    socket.on("connect", () => {
      console.log(`[${new Date().toISOString()}] direct connect → ${process.env.SEED_HOST}:${port}`);
      const s = store.replicate(true);
      s.pipe(socket).pipe(s);
    });
    socket.on("error", (e) => console.log(`[${new Date().toISOString()}] direct dial error: ${e.message}`));
    socket.on("close", () => setTimeout(dial, 5000));
  };
  dial();
}

// ── Read surface over the PUBLIC core ────────────────────────────────────────
const bee = new Hyperbee(publicCore, { keyEncoding: "utf-8", valueEncoding: "binary" });
await bee.ready();
const reader = new CensusReader();
reader.setBee(bee);

const send = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "health") {
      return send(res, 200, {
        ok: true,
        ready: reader.ready,
        blocks: { have: publicCore.contiguousLength, known: publicCore.length },
      });
    }

    if (parts[0] === "census" && parts[1] === "stats") {
      const minCell = url.searchParams.has("minCell") ? Number(url.searchParams.get("minCell")) : undefined;
      return send(res, 200, { stats: await reader.getStats(minCell != null ? { minCell } : {}) });
    }

    if (parts[0] === "census" && parts[1] === "weavers") {
      if (parts[2]) {
        return send(res, 200, { weaver: await reader.retrieveWeaver(decodeURIComponent(parts[2])) });
      }
      const filters = {};
      let limit, offset, after;
      for (const [k, v] of url.searchParams) {
        if (k === "limit") limit = Number(v);
        else if (k === "offset") offset = Number(v);
        else if (k === "after") after = v;
        else filters[k] = v;
      }
      const opts = {};
      if (limit != null) opts.limit = limit;
      if (offset != null) opts.offset = offset;
      if (after != null) opts.after = after;
      return send(res, 200, await reader.listAndCountWeavers(filters, opts));
    }

    return send(res, 404, { message: "not found" });
  } catch (e) {
    send(res, 500, { message: e?.message || "error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[census-node] read surface on 127.0.0.1:${PORT} store=${STORE_DIR} public=${publicCore.key.toString("hex").slice(0, 12)}…`);
});

const report = () => {
  const parts = cores.map((c, i) =>
    `${["public", "sensitive", "extra"][i] || "core" + i}=${c.contiguousLength}/${c.length}`);
  console.log(`[${new Date().toISOString()}] peers=${swarm.connections.size}  mirror blocks (have/known): ${parts.join("  ")}`);
};
setInterval(report, 5 * 60 * 1000);
await new Promise((r) => setTimeout(r, 3000));
report();
console.log("census reader node: replicating + persisting all cores; serving public read API (sensitive stays opaque)");
