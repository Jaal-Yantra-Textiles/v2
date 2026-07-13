// Proof: a MikroORM-style repository over Hyperbee — the shape a Medusa module
// service would expose, so API routes/workflows could call it unchanged.
//
//   listAndCountWeavers(filters, { take, skip, order }) -> [rows, count]
//   retrieveWeaver(id) -> row
//   createWeaver(data) -> row   (+ maintains secondary indexes, like an ORM)
//
// Equality filters resolve through secondary index sub-dbs (idx/<field>/<value>/<id>),
// intersected when multiple — i.e. a tiny query planner over an ordered KV store.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { readFileSync, rmSync } from "node:fs";

const INDEXED = ["social_group", "own_looms", "gender", "district", "state"];

class WeaverRepository {
  constructor(bee) {
    this.recs = bee.sub("rec", { valueEncoding: "binary" });
    this.idx = bee.sub("idx", { valueEncoding: "utf-8" });
  }
  _enc(o) { return brotliCompressSync(Buffer.from(JSON.stringify(o))); }
  _dec(b) { return JSON.parse(brotliDecompressSync(b).toString()); }
  _ik(f, v, id) { return `${f}/${String(v)}/${id}`; }

  async createWeaver(data) {
    const id = String(data.census_id);
    const { mobile, ...pub } = data;                 // mask stays enforced here too
    pub.mobile_masked = data.mobile_masked || "91XXXXXXXXXX";
    await this.recs.put(id, this._enc(pub));
    for (const f of INDEXED)
      if (pub[f] !== undefined && pub[f] !== null)
        await this.idx.put(this._ik(f, pub[f], id), id);
    return pub;
  }

  async retrieveWeaver(id) {
    const n = await this.recs.get(String(id));
    return n ? this._dec(n.value) : null;
  }

  async _idsFor(field, value) {
    const ids = new Set();
    const p = `${field}/${String(value)}/`;
    for await (const { value: id } of this.idx.createReadStream({ gte: p, lt: p + "~" }))
      ids.add(id);
    return ids;
  }

  async listAndCountWeavers(filters = {}, { take = 20, skip = 0, order } = {}) {
    const idxFilters = Object.entries(filters).filter(([k]) => INDEXED.includes(k));
    const residual = Object.entries(filters).filter(([k]) => !INDEXED.includes(k));

    let ids;
    if (idxFilters.length) {
      // intersect the indexed predicates (query planner: AND of index scans)
      const sets = await Promise.all(idxFilters.map(([k, v]) => this._idsFor(k, v)));
      ids = [...sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))];
    } else {
      ids = [];
      for await (const { key } of this.recs.createReadStream()) ids.push(key);
    }
    ids.sort();
    if (order === "desc") ids.reverse();

    const count = ids.length;
    const rows = [];
    for (const id of ids.slice(skip, skip + take)) {
      const r = await this.retrieveWeaver(id);
      if (residual.every(([k, v]) => r[k] === v)) rows.push(r);
    }
    return [rows, count];
  }
}

// ── demo on the real AMBALA-119 ──────────────────────────────────────────
rmSync("./_repo", { recursive: true, force: true });
const store = new Corestore("./_repo");
const bee = new Hyperbee(store.get({ name: "weavers" }), { keyEncoding: "utf-8", valueEncoding: "binary" });
const repo = new WeaverRepository(bee);

const records = readFileSync("../data/live/ambala_full.jsonl", "utf8").trim().split("\n").map(JSON.parse);
for (const r of records) await repo.createWeaver(r);
console.log(`seeded ${records.length} weavers\n`);

console.log("retrieveWeaver('2904500'):");
const one = await repo.retrieveWeaver("2904500");
console.log(`  ${one.name} | ${one.social_group} | own_looms=${one.own_looms} | worked=${one.total_looms_worked} | mobile=${one.mobile ?? "<masked>"}\n`);

let [rows, count] = await repo.listAndCountWeavers({ social_group: "Scheduled Tribe" }, { take: 3 });
console.log(`listAndCount({social_group:'Scheduled Tribe'}) -> count=${count}, page:`);
rows.forEach((r) => console.log(`  ${r.census_id} ${r.name}`));

[rows, count] = await repo.listAndCountWeavers({ own_looms: false, district: "AMBALA" }, { take: 2, skip: 0 });
console.log(`\nlistAndCount({own_looms:false, district:'AMBALA'}) -> count=${count} (indexed AND), page of 2:`);
rows.forEach((r) => console.log(`  ${r.census_id} ${r.name} worked=${r.total_looms_worked}`));

await store.close();
rmSync("./_repo", { recursive: true, force: true });
process.exit(0);
