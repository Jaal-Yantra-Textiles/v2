// P2P seeder: ingest the crawled per-state JSONL into a Hyperbee core (compressed
// records + region/social indexes), then ANNOUNCE it on the Hyperswarm DHT so the
// Medusa backend can open it BY KEY and read sparsely over the internet — the
// same read path as ingest_replicate.mjs, but over Hyperswarm instead of a
// localhost socket. Print the public key; that's all the reader needs.
//
//   node seed_p2p.mjs                 # ingest ../data/live/*.jsonl + seed forever
//   node seed_p2p.mjs --once          # ingest + print key + exit (no seeding)
//
// deps: corestore hyperbee hyperswarm b4a  (npm i hyperswarm)

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";
import { brotliCompressSync } from "node:zlib";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const STORE_DIR = process.env.P2P_STORE || "./p2p-store";
const DATA_DIR = "../data/live";
const once = process.argv.includes("--once");

const store = new Corestore(STORE_DIR);
const core = store.get({ name: "handloom-weavers-v1" });   // stable name → stable key across restarts
await core.ready();
const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" });
const recs = bee.sub("rec", { valueEncoding: "binary" });
const region = bee.sub("region", { valueEncoding: "utf-8" });
const bySocial = bee.sub("idx_social", { valueEncoding: "utf-8" });

// ingest every state file (idempotent: keyed by census_id, mask enforced)
let ingested = 0;
for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith(".jsonl"))) {
  for (const line of readFileSync(`${DATA_DIR}/${file}`, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const id = String(r.census_id);
    const { mobile, ...pub } = r;                          // real mobile never enters the public core
    pub.mobile_masked = r.mobile_masked || "91XXXXXXXXXX";
    await recs.put(id, brotliCompressSync(Buffer.from(JSON.stringify(pub))));
    await region.put(`${r.region_state}/${r.district || ""}/${id}`, id);
    await bySocial.put(`${r.social_group || "unknown"}/${id}`, id);
    ingested++;
  }
}
const key = core.key.toString("hex");
writeFileSync("./PUBLIC_KEY.txt", key + "\n");
console.log(`ingested ${ingested} records; public core key:\n  ${key}\n(saved to PUBLIC_KEY.txt — give this to the Medusa reader)`);

if (once) { await store.close(); process.exit(0); }

// announce on the DHT and serve replication requests forever
const swarm = new Hyperswarm();
swarm.on("connection", (conn) => store.replicate(conn));
const discovery = swarm.join(core.discoveryKey, { server: true, client: false });
await discovery.flushed();
console.log("seeding on Hyperswarm DHT — readers can now sync by key. Ctrl-C to stop.");
