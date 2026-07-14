// REAL end-to-end test: the branch's actual Medusa PersonPropertyService running
// over a Hyperbee-backed DAL — no Postgres, no MikroORM.
//
// We import the REAL service class (src/modules/personproperty/service.ts), which
// is `class extends MedusaService({ PersonProperty })`. Medusa's generated
// methods delegate to `container[`${model}Service`]` (the internal per-model
// service) and `container.baseRepository.serialize`. So if we register a
// Hyperbee-backed internal service + baseRepository in the container, the REAL
// generated create/list/listAndCount/retrieve/update/delete run unchanged.
//
// Run:  ../../../node_modules/.bin/tsx person-property-medusa-e2e.ts

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { rmSync } from "node:fs";
import assert from "node:assert";
import { MedusaError } from "@medusajs/framework/utils";

// the ACTUAL service from the branch (CJS-interop double-wraps the default export)
import * as PersonPropertyServiceMod from "../../../apps/backend/src/modules/personproperty/service";
const PersonPropertyService: any =
  (PersonPropertyServiceMod as any).default?.default ?? (PersonPropertyServiceMod as any).default;

let PASS = 0;
const ok = (l: string, c: boolean) => { assert(c, `FAIL: ${l}`); console.log(`  ✓ ${l}`); PASS++; };

// ── Hyperbee-backed internal model service (the DAL Medusa calls) ────────────
const INDEXED = ["profile_type", "social_group", "district", "own_looms"];
const match = (row: any, where: any = {}) =>
  Object.entries(where).every(([k, cond]: any) => {
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

class HyperbeeModelService {
  recs: any; idx: any; seq = 0; prefix: string;
  constructor(bee: any, prefix = "pp") {
    this.prefix = prefix;
    this.recs = bee.sub("rec", { valueEncoding: "binary" });
    this.idx = bee.sub("idx", { valueEncoding: "utf-8" });
  }
  _enc(o: any) { return brotliCompressSync(Buffer.from(JSON.stringify(o))); }
  _dec(b: Buffer) { return JSON.parse(brotliDecompressSync(b).toString()); }
  _id() { return `${this.prefix}_${String(++this.seq).padStart(6, "0")}`; }
  async _index(row: any) {
    for (const f of INDEXED) if (row[f] != null) await this.idx.put(`${f}/${row[f]}/${row.id}`, row.id);
  }
  async _deindex(row: any) {
    for (const f of INDEXED) if (row[f] != null) await this.idx.del(`${f}/${row[f]}/${row.id}`);
  }
  async _get(id: string) { const n = await this.recs.get(String(id)); return n ? this._dec(n.value) : null; }

  // ---- the internal-service surface Medusa's generated methods call ----
  async create(data: any) {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const d of arr) {
      const row = { id: d.id || this._id(), ...d };
      await this.recs.put(row.id, this._enc(row));
      await this._index(row);
      out.push(row);
    }
    return Array.isArray(data) ? out : out[0];
  }
  async retrieve(id: string) {
    const r = await this._get(id);
    if (!r) throw new MedusaError(MedusaError.Types.NOT_FOUND, `PersonProperty ${id} not found`);
    return r;
  }
  async _candidates(where: any = {}) {
    const eq = Object.entries(where).filter(([k, v]) => INDEXED.includes(k) && (typeof v !== "object" || v === null));
    if (eq.length) {
      const sets = await Promise.all(eq.map(async ([k, v]) => {
        const s = new Set<string>(); const p = `${k}/${v}/`;
        for await (const { value: id } of this.idx.createReadStream({ gte: p, lt: p + "~" })) s.add(id);
        return s;
      }));
      return [...sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))];
    }
    const ids: string[] = [];
    for await (const { key } of this.recs.createReadStream()) ids.push(key);
    return ids;
  }
  async list(filters: any = {}, config: any = {}) {
    const ids = await this._candidates(filters);
    let rows: any[] = [];
    for (const id of ids) { const r = await this._get(id); if (r && match(r, filters)) rows.push(r); }
    const { take = 15, skip = 0, order } = config || {};
    if (order) {
      const [f, dir] = Object.entries(order)[0] as [string, string];
      rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (String(dir).toUpperCase() === "DESC" ? -1 : 1));
    } else rows.sort((a, b) => (a.id > b.id ? 1 : -1));
    return rows.slice(skip, skip + take);
  }
  async listAndCount(filters: any = {}, config: any = {}) {
    const ids = await this._candidates(filters);
    let rows: any[] = [];
    for (const id of ids) { const r = await this._get(id); if (r && match(r, filters)) rows.push(r); }
    const count = rows.length;
    return [await this.list(filters, config), count];
  }
  async update(data: any) {
    const arr = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const d of arr) {
      const cur = await this.retrieve(d.id);
      await this._deindex(cur);
      const row = { ...cur, ...d };
      await this.recs.put(row.id, this._enc(row));
      await this._index(row);
      out.push(row);
    }
    return Array.isArray(data) ? out : out[0];
  }
  async delete(pks: string[]) {
    for (const id of pks) { const cur = await this._get(id); if (cur) { await this._deindex(cur); await this.recs.del(id); } }
  }
  async softDelete() { return [[], {}]; }
  async restore() { return [[], {}]; }
}

// ── build the container Medusa's factory expects, wire the REAL service ──────
rmSync("./_e2e", { recursive: true, force: true });
const store = new Corestore("./_e2e");
const bee = new Hyperbee(store.get({ name: "person_property" }), { keyEncoding: "utf-8", valueEncoding: "binary" });
const internal = new HyperbeeModelService(bee);

const container: any = {
  // baseRepository provides serialize + the manager/transaction seam the
  // @InjectManager / @InjectTransactionManager decorators call. For a KV store
  // the "manager" is a no-op and a transaction just runs the task inline.
  baseRepository: {
    serialize: async (d: any) => JSON.parse(JSON.stringify(d)),
    getFreshManager: () => internal,
    getActiveManager: () => internal,
    transaction: async (task: any) => task(internal),
  },
  personPropertyService: internal,                         // lowerCaseFirst("PersonProperty") + "Service"
  eventBusModuleService: { emit: async () => {} },         // stubs in case constructor wires events
  messageAggregator: { saveRawMessageData() {}, getMessages() { return []; }, clearMessages() {} },
};

const svc: any = new PersonPropertyService(container);
console.log("Instantiated the REAL PersonPropertyService over a Hyperbee DAL.\n");

// ── drive the REAL generated methods ────────────────────────────────────────
console.log("── createPersonProperties (real generated method) ──");
const one = await svc.createPersonProperties({
  profile_type: "weaver", census_id: "2904500", social_group: "Schedule Caste",
  district: "AMBALA", own_looms: true, total_looms_owned: 2,
});
ok(`created single → id ${one.id}`, !!one.id && one.social_group === "Schedule Caste");

const many = await svc.createPersonProperties([
  { profile_type: "weaver", census_id: "2904501", social_group: "Scheduled Tribe", district: "AMBALA", own_looms: false, total_looms_owned: 0 },
  { profile_type: "weaver", census_id: "2904502", social_group: "Other Backward Caste", district: "PANIPAT", own_looms: true, total_looms_owned: 3 },
  { profile_type: "weaver", census_id: "2904503", social_group: "Scheduled Tribe", district: "AMBALA", own_looms: true, total_looms_owned: 4 },
]);
ok("created batch of 3", Array.isArray(many) && many.length === 3);

console.log("\n── listPersonProperties + filters ──");
const st = await svc.listPersonProperties({ social_group: "Scheduled Tribe" });
ok(`filter social_group='Scheduled Tribe' → ${st.length} rows`, st.length === 2 && st.every((r: any) => r.social_group === "Scheduled Tribe"));

const ambala = await svc.listPersonProperties({ district: "AMBALA", own_looms: true });
ok(`compound filter district=AMBALA ∧ own_looms=true → ${ambala.length}`, ambala.length === 2);

const heavy = await svc.listPersonProperties({ total_looms_owned: { $gte: 2 } });
ok(`operator filter total_looms_owned>=2 → ${heavy.length}`, heavy.length === 3);

console.log("\n── listAndCountPersonProperties + pagination ──");
const [page, count] = await svc.listAndCountPersonProperties({ profile_type: "weaver" }, { take: 2, skip: 0, order: { census_id: "ASC" } });
ok(`count=4 total weavers, page of 2 returned`, count === 4 && page.length === 2);

console.log("\n── retrievePersonProperty ──");
const got = await svc.retrievePersonProperty(one.id);
ok("retrieve by id", got.census_id === "2904500");
let threw = false;
try { await svc.retrievePersonProperty("pp_999999"); } catch (e: any) { threw = e instanceof MedusaError; }
ok("retrieve missing → MedusaError NOT_FOUND", threw);

console.log("\n── updatePersonProperties (+ reindex) ──");
await svc.updatePersonProperties({ id: many[1].id, district: "KARNAL" });   // PANIPAT → KARNAL
ok("update moved district out of PANIPAT", (await svc.listPersonProperties({ district: "PANIPAT" })).length === 0);
ok("update moved district into KARNAL (reindexed)", (await svc.listPersonProperties({ district: "KARNAL" })).length === 1);

console.log("\n── deletePersonProperties ──");
await svc.deletePersonProperties(many[0].id);
ok("delete removed the row", (await svc.listAndCountPersonProperties({ profile_type: "weaver" }))[1] === 3);

await store.close();
rmSync("./_e2e", { recursive: true, force: true });
console.log(`\n✅ ${PASS}/${PASS} assertions — the REAL Medusa PersonPropertyService runs end-to-end over a Hyperbee DAL (no Postgres).`);
process.exit(0);
