// Synthetic AMBALA-shaped fixture — NO real PII. Deterministic (seeded LCG).
import { mkdirSync, writeFileSync } from "node:fs";
let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const groups = ["Schedule Caste", "Scheduled Tribe", "Other Backward Caste", "General"];
const names = ["Ram", "Sita", "Mohan", "Radha", "Gopal", "Meena", "Suresh", "Kavita"];
const rows = [];
for (let i = 0; i < 119; i++) {
  const id = 2904500 + i;
  const g = pick(["Male", "Female"]);
  const pit = Math.floor(rnd() * 3), frame = Math.floor(rnd() * 2);
  rows.push({
    census_id: id, name: `${pick(names)} ${pick(names)}`, gender: g,
    age: 20 + Math.floor(rnd() * 45), religion: pick(["Hindu", "Muslim", "Sikh"]),
    social_group: pick(groups), rural_urban: pick(["Rural", "Urban"]),
    own_looms: rnd() > 0.5, total_looms_owned: pit + frame,
    total_looms_worked: Math.floor(rnd() * 4),
    pit_loom_count: pit, frame_loom_count: frame, loin_loom_count: 0, other_loom_count: 0,
    natural_dye_used: rnd() > 0.6, avg_production_meters: 10 + Math.floor(rnd() * 40),
    sells_local_market: rnd() > 0.3, sells_master_weaver: rnd() > 0.5,
    sells_cooperative: rnd() > 0.7, sells_ecommerce: rnd() > 0.9,
    state: "HARYANA", district: "AMBALA", block: "AMBALA",
    // sensitive (go to the encrypted core only):
    latitude: (30.3 + rnd()).toFixed(6), longitude: (76.7 + rnd()).toFixed(6),
    house_no: String(1 + Math.floor(rnd() * 200)),
    monthly_income: 5000 + Math.floor(rnd() * 20000),
    handloom_income: 3000 + Math.floor(rnd() * 12000),
    mobile: "9" + String(100000000 + Math.floor(rnd() * 899999999)),
    mobile_masked: "91XXXXXXXXXX",
  });
}
mkdirSync("../data/live", { recursive: true });
writeFileSync("../data/live/ambala_full.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} synthetic records to data/live/ambala_full.jsonl`);
