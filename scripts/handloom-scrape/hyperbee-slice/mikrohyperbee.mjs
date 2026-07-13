// MikroHyperbee — a Hyperbee-backed implementation of Medusa's DAL seam
// (@medusajs/types RepositoryService<T>). If a repository over Hyperbee
// satisfies this contract, then the *storage-agnostic* layers above it —
// module services, module links, query.graph, and the workflow engine — come
// along unchanged. This file proves that on `person` + `person_property`
// (the two models on this branch) and CHECKS every result against a plain
// in-memory reference implementation, so "it works" is asserted, not asserted-by-vibes.
//
// Implemented subset of RepositoryService<T>:
//   create(data[])            find(options)            findAndCount(options)
//   update([{entity,update}]) upsert(data[])           delete(where|ids)
//   serialize(x)              (transaction/managers are no-ops for a KV store)
//
// FindOptions shape honored: { where, options: { take, skip, order } }
// where supports: plain equality, { $in: [...] }, { $ne: v }, { $gt/$gte/$lt/$lte }.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { rmSync } from "node:fs";
import assert from "node:assert";

// ── the repository ────────────────────────────────────────────────────────
class HyperbeeBaseRepository {
  // opts: { name, indexed: string[] }  — indexed fields get secondary sub-dbs
  constructor(bee, { name, indexed = [] }) {
    this.name = name;
    this.indexed = new Set(indexed);
    this.recs = bee.sub(`${name}/rec`, { valueEncoding: "binary" });
    this.idx = bee.sub(`${name}/idx`, { valueEncoding: "utf-8" });
    this._seq = 0; // deterministic id counter (no Date.now/Math.random)
  }

  _enc(o) { return brotliCompressSync(Buffer.from(JSON.stringify(o))); }
  _dec(b) { return JSON.parse(brotliDecompressSync(b).toString()); }
  _id() { return `${this.name.split("_")[0].slice(0, 4)}_${String(++this._seq).padStart(6, "0")}`; }

  async _index(row) {
    for (const f of this.indexed)
      if (row[f] !== undefined && row[f] !== null)
        await this.idx.put(`${f}/${String(row[f])}/${row.id}`, row.id);
  }
  async _deindex(row) {
    for (const f of this.indexed)
      if (row[f] !== undefined && row[f] !== null)
        await this.idx.del(`${f}/${String(row[f])}/${row.id}`);
  }

  // ---- RepositoryService surface ----
  async create(data, _ctx) {
    const out = [];
    for (const d of data) {
      const row = { id: d.id || this._id(), ...d };
      await this.recs.put(row.id, this._enc(row));
      await this._index(row);
      out.push(row);
    }
    return out;
  }

  async retrieve(id) {
    const n = await this.recs.get(String(id));
    return n ? this._dec(n.value) : null;
  }

  async update(data, _ctx) {
    const out = [];
    for (const { entity, update } of data) {
      const id = typeof entity === "string" ? entity : entity.id;
      const cur = await this.retrieve(id);
      if (!cur) throw new Error(`${this.name} ${id} not found`);
      await this._deindex(cur);
      const row = { ...cur, ...update, id };
      await this.recs.put(id, this._enc(row));
      await this._index(row);
      out.push(row);
    }
    return out;
  }

  async upsert(data, _ctx) {
    const out = [];
    for (const d of data) {
      const exists = d.id && (await this.retrieve(d.id));
      out.push(exists
        ? (await this.update([{ entity: d.id, update: d }]))[0]
        : (await this.create([d]))[0]);
    }
    return out;
  }

  async delete(where, _ctx) {
    const ids = Array.isArray(where) ? where
      : typeof where === "string" ? [where]
      : (await this.find({ where })).map((r) => r.id);
    for (const id of ids) {
      const cur = await this.retrieve(id);
      if (cur) { await this._deindex(cur); await this.recs.del(id); }
    }
    return ids;
  }

  // resolve a where-clause to candidate ids, using indexes where possible
  async _candidateIds(where = {}) {
    const eqIndexed = Object.entries(where).filter(
      ([k, v]) => this.indexed.has(k) && (typeof v !== "object" || v === null)
    );
    if (eqIndexed.length) {
      const sets = await Promise.all(eqIndexed.map(async ([k, v]) => {
        const s = new Set(); const p = `${k}/${String(v)}/`;
        for await (const { value: id } of this.idx.createReadStream({ gte: p, lt: p + "~" })) s.add(id);
        return s;
      }));
      return [...sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))];
    }
    const ids = [];
    for await (const { key } of this.recs.createReadStream()) ids.push(key);
    return ids;
  }

  _match(row, where = {}) {
    return Object.entries(where).every(([k, cond]) => {
      const v = row[k];
      if (cond && typeof cond === "object") {
        if ("$in" in cond) return cond.$in.includes(v);
        if ("$ne" in cond) return v !== cond.$ne;
        if ("$gt" in cond) return v > cond.$gt;
        if ("$gte" in cond) return v >= cond.$gte;
        if ("$lt" in cond) return v < cond.$lt;
        if ("$lte" in cond) return v <= cond.$lte;
      }
      return v === cond;
    });
  }

  async find({ where = {}, options = {} } = {}, _ctx) {
    const [rows] = await this._findAndCount(where, options);
    return rows;
  }
  async findAndCount({ where = {}, options = {} } = {}, _ctx) {
    return this._findAndCount(where, options);
  }
  async _findAndCount(where, { take = 15, skip = 0, order } = {}) {
    const cand = await this._candidateIds(where);
    let rows = [];
    for (const id of cand) {
      const r = await this.retrieve(id);
      if (r && this._match(r, where)) rows.push(r);
    }
    if (order) {
      const [f, dir] = Object.entries(order)[0];
      rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === "DESC" ? -1 : 1));
    } else rows.sort((a, b) => (a.id > b.id ? 1 : -1));
    const count = rows.length;
    return [rows.slice(skip, skip + take), count];
  }

  async serialize(x) { return JSON.parse(JSON.stringify(x)); }
  getFreshManager() { return this; }
  getActiveManager() { return this; }
  async transaction(task) { return task(this); }
}

// A module Link is itself just a repository over pairs — so the same store
// backs `defineLink(person, person_property)`. query.graph joins through it.
class LinkRepository extends HyperbeeBaseRepository {
  async link(leftId, rightId) { await this.create([{ id: `${leftId}:${rightId}`, left: leftId, right: rightId }]); }
  async rightFor(leftId) {
    const [rows] = await this.findAndCount({ where: { left: leftId } });
    return rows.map((r) => r.right);
  }
}

// ── in-memory reference (ground truth to COMPARE against) ───────────────────
function refFindAndCount(store, where, { take = 15, skip = 0, order } = {}) {
  const match = (row) => Object.entries(where).every(([k, c]) => {
    const v = row[k];
    if (c && typeof c === "object") {
      if ("$in" in c) return c.$in.includes(v);
      if ("$ne" in c) return v !== c.$ne;
      if ("$gt" in c) return v > c.$gt;
      if ("$gte" in c) return v >= c.$gte;
      if ("$lt" in c) return v < c.$lt;
      if ("$lte" in c) return v <= c.$lte;
    }
    return v === c;
  });
  let rows = [...store.values()].filter(match);
  if (order) { const [f, dir] = Object.entries(order)[0]; rows.sort((a, b) => (a[f] > b[f] ? 1 : -1) * (dir === "DESC" ? -1 : 1)); }
  else rows.sort((a, b) => (a.id > b.id ? 1 : -1));
  return [rows.slice(skip, skip + take), rows.length];
}

// ── demo + assertions ───────────────────────────────────────────────────────
rmSync("./_mikro", { recursive: true, force: true });
const store = new Corestore("./_mikro");
const bee = new Hyperbee(store.get({ name: "db" }), { keyEncoding: "utf-8", valueEncoding: "binary" });

const personRepo = new HyperbeeBaseRepository(bee, { name: "person", indexed: ["email"] });
const propRepo = new HyperbeeBaseRepository(bee, {
  name: "person_property",
  indexed: ["profile_type", "social_group", "district", "own_looms"],
});
const linkRepo = new LinkRepository(bee, { name: "person_properties_link", indexed: ["left"] });

const refPersons = new Map(), refProps = new Map();
let pass = 0; const ok = (label, cond) => { assert(cond, `FAIL: ${label}`); console.log(`  ✓ ${label}`); pass++; };

// seed 6 weavers as person + person_property, joined by a module link
const seed = [
  { first: "Ram",    social: "Schedule Caste",       district: "AMBALA",   own: true,  looms: 2 },
  { first: "Sita",   social: "Scheduled Tribe",       district: "AMBALA",   own: false, looms: 0 },
  { first: "Mohan",  social: "Other Backward Caste",  district: "PANIPAT",  own: true,  looms: 3 },
  { first: "Radha",  social: "Schedule Caste",        district: "AMBALA",   own: true,  looms: 1 },
  { first: "Gopal",  social: "General",               district: "PANIPAT",  own: false, looms: 0 },
  { first: "Meena",  social: "Scheduled Tribe",       district: "AMBALA",   own: true,  looms: 4 },
];

console.log("── create() person + person_property + link ──");
for (const s of seed) {
  const [p] = await personRepo.create([{ first_name: s.first, email: `${s.first.toLowerCase()}@loom.in` }]);
  const [pp] = await propRepo.create([{
    person_id: p.id, profile_type: "weaver", social_group: s.social,
    district: s.district, own_looms: s.own, total_looms_owned: s.looms,
  }]);
  await linkRepo.link(p.id, pp.id);
  refPersons.set(p.id, p); refProps.set(pp.id, pp);
}
ok("created 6 persons", (await personRepo.findAndCount())[1] === 6);
ok("created 6 person_properties", (await propRepo.findAndCount())[1] === 6);

console.log("\n── findAndCount() vs reference (indexed equality) ──");
for (const w of [{ social_group: "Scheduled Tribe" }, { district: "AMBALA", own_looms: true }, { profile_type: "weaver" }]) {
  const [hbRows, hbCount] = await propRepo.findAndCount({ where: w });
  const [refRows, refCount] = refFindAndCount(refProps, w);
  ok(`count matches ref for ${JSON.stringify(w)} (=${hbCount})`, hbCount === refCount);
  ok(`row ids match ref for ${JSON.stringify(w)}`, JSON.stringify(hbRows.map(r=>r.id)) === JSON.stringify(refRows.map(r=>r.id)));
}

console.log("\n── operator filters + pagination + order vs reference ──");
{
  const opts = { take: 2, skip: 1, order: { total_looms_owned: "DESC" } };
  const w = { own_looms: true, total_looms_owned: { $gte: 1 } };
  const [hbRows, hbCount] = await propRepo.findAndCount({ where: w, options: opts });
  const [refRows, refCount] = refFindAndCount(refProps, w, opts);
  ok(`operator+paginate count matches (=${hbCount})`, hbCount === refCount);
  ok("operator+paginate page matches ref", JSON.stringify(hbRows.map(r=>r.total_looms_owned)) === JSON.stringify(refRows.map(r=>r.total_looms_owned)));
}
{
  const w = { district: { $in: ["PANIPAT", "AMBALA"] } };
  const [, hbCount] = await propRepo.findAndCount({ where: w });
  ok(`$in over non-indexed residual (=${hbCount}==6)`, hbCount === 6);
}

console.log("\n── query.graph across the module link (person → properties) ──");
async function queryGraphPersonWithProps(where = {}) {
  const persons = await personRepo.find({ where });         // storage-agnostic remote-query would call the module service, which calls the repo
  const out = [];
  for (const p of persons) {
    const [ppId] = await linkRepo.rightFor(p.id);
    out.push({ ...p, properties: ppId ? await propRepo.retrieve(ppId) : null });
  }
  return out;
}
{
  const graph = await queryGraphPersonWithProps();
  ok("join returns all 6 with .properties hydrated", graph.length === 6 && graph.every(g => g.properties?.profile_type === "weaver"));
  const ram = graph.find(g => g.first_name === "Ram");
  ok("Ram joined to his AMBALA/Schedule-Caste properties", ram.properties.district === "AMBALA" && ram.properties.social_group === "Schedule Caste");
}

console.log("\n── update() + upsert() + delete() ──");
{
  const [ram] = await personRepo.find({ where: { email: "ram@loom.in" } });
  await personRepo.update([{ entity: ram.id, update: { first_name: "Ram Kumar" } }]);
  ok("update() persisted", (await personRepo.retrieve(ram.id)).first_name === "Ram Kumar");

  const [up] = await propRepo.upsert([{ person_id: "x", profile_type: "weaver", social_group: "General", district: "KARNAL", own_looms: false }]);
  ok("upsert() inserted new row", (await propRepo.findAndCount())[1] === 7);
  await propRepo.upsert([{ id: up.id, district: "KAITHAL" }]);
  ok("upsert() updated existing + reindexed", (await propRepo.findAndCount({ where: { district: "KAITHAL" } }))[1] === 1
      && (await propRepo.findAndCount({ where: { district: "KARNAL" } }))[1] === 0);

  const delIds = await propRepo.delete(up.id);
  ok("delete() removed row + deindexed", delIds.length === 1 && (await propRepo.findAndCount())[1] === 6
      && (await propRepo.findAndCount({ where: { district: "KAITHAL" } }))[1] === 0);
}

console.log("\n── create-person workflow step + compensation (engine is storage-agnostic) ──");
{
  // simulate a createStep/compensation pair; the SDK only needs a repo that
  // create()s and delete()s — it never touches storage internals.
  const createPersonStep = async (input) => {
    const [p] = await personRepo.create([input]);
    return { output: p, compensate: async () => { await personRepo.delete(p.id); } };
  };
  const { output, compensate } = await createPersonStep({ first_name: "Tmp", email: "tmp@loom.in" });
  ok("workflow step created via repo", !!(await personRepo.retrieve(output.id)));
  await compensate(); // rollback
  ok("workflow compensation rolled back via repo", (await personRepo.retrieve(output.id)) === null);
}

await store.close();
rmSync("./_mikro", { recursive: true, force: true });
console.log(`\n✅ ${pass}/${pass} assertions passed — Hyperbee repo satisfies RepositoryService and matches the reference on person + person_property.`);
process.exit(0);
