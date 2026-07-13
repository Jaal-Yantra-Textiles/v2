// Deliverables 1 + 2 on the real AMBALA-119 batch:
//   1. Full ingest into a Hyperbee (compressed records + region/analytics indexes)
//   2. Replicate the store to a SECOND peer over a real TCP socket, then query it
//      sparsely (on-demand) — the exact path that runs between remote free servers.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import net from "node:net";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { readFileSync, rmSync } from "node:fs";

const PORT = 41234;
rmSync("./_seeder", { recursive: true, force: true });
rmSync("./_reader", { recursive: true, force: true });

const records = readFileSync("../data/live/ambala_full.jsonl", "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// ─── SEEDER (server A) ───────────────────────────────────────────────────
const seeder = new Corestore("./_seeder");
const pubCore = seeder.get({ name: "public" });
await pubCore.ready();
const bee = new Hyperbee(pubCore, { keyEncoding: "utf-8", valueEncoding: "binary" });
const recs = bee.sub("rec", { valueEncoding: "binary" });
const region = bee.sub("region", { valueEncoding: "utf-8" });
const bySocial = bee.sub("idx_social", { valueEncoding: "utf-8" });

let raw = 0, comp = 0;
for (const r of records) {
  const id = String(r.census_id);
  const { mobile, ...pub } = r;            // mask: real mobile never enters the public core
  pub.mobile_masked = r.mobile_masked || "91XXXXXXXXXX";
  const c = brotliCompressSync(Buffer.from(JSON.stringify(pub)));
  raw += JSON.stringify(pub).length; comp += c.length;
  await recs.put(id, c);
  await region.put(`${r.state}/${r.district}/${r.block || r.district}/${id}`, id);
  await bySocial.put(`${(r.social_group || "unknown")}/${id}`, id);
}
const key = pubCore.key.toString("hex");
console.log(`SEEDER: ingested ${records.length} records`);
console.log(`  compression: ${raw}B -> ${comp}B (${(100 - 100 * comp / raw).toFixed(0)}% smaller)`);
console.log(`  public core key: ${key.slice(0, 16)}…`);

// capacity analytics straight off the index (range scan per social group)
console.log(`  capacity by social_group:`);
for (const g of ["Schedule Caste", "Scheduled Tribe", "Other Backward Caste"]) {
  let n = 0;
  for await (const _ of bySocial.createReadStream({ gte: `${g}/`, lt: `${g}/~` })) n++;
  console.log(`    ${g}: ${n}`);
}

const server = net.createServer((socket) => {
  const s = seeder.replicate(false);
  socket.pipe(s).pipe(socket);
  s.on("error", () => {}); socket.on("error", () => {});
});
await new Promise((res) => server.listen(PORT, res));
console.log(`SEEDER: listening on tcp://127.0.0.1:${PORT}\n`);

// ─── READER (server B) — knows only the key, pulls over the network ──────
const reader = new Corestore("./_reader");
const rCore = reader.get({ key: Buffer.from(key, "hex") });
await rCore.ready();
console.log(`READER: opened core by key; has 0 blocks locally? -> length=${rCore.length}`);

const socket = net.connect(PORT, "127.0.0.1");
const rs = reader.replicate(true);
socket.pipe(rs).pipe(socket);
await rCore.update({ wait: true });        // learn latest length from the peer
console.log(`READER: after connecting to seeder, core length synced -> ${rCore.length}`);

const rbee = new Hyperbee(rCore, { keyEncoding: "utf-8", valueEncoding: "binary" });
const rRegion = rbee.sub("region", { valueEncoding: "utf-8" });
const rRecs = rbee.sub("rec", { valueEncoding: "binary" });

// sparse range query pulled on demand over the socket
let ids = [];
for await (const { value } of rRegion.createReadStream({
  gte: "HARYANA/AMBALA/AMBALA/", lt: "HARYANA/AMBALA/AMBALA/~",
})) ids.push(value);
console.log(`READER: range query over network -> ${ids.length} weavers in HARYANA/AMBALA/AMBALA`);

const node = await rRecs.get(ids[0]);
const rec = JSON.parse(brotliDecompressSync(node.value).toString());
console.log(`READER: fetched+decompressed one record over the wire:`);
console.log(`  ${rec.census_id}  ${rec.name}  ${rec.social_group}  mobile=${rec.mobile ?? "<masked>"} (${rec.mobile_masked})`);
console.log(`  blocks now cached locally on reader: ${rCore.contiguousLength}/${rCore.length} (sparse — only what we queried)`);

socket.destroy(); server.close();
await seeder.close(); await reader.close();
rmSync("./_seeder", { recursive: true, force: true });
rmSync("./_reader", { recursive: true, force: true });
console.log("\nOK — data created on peer A was queried from peer B over TCP, sparsely.");
process.exit(0);
