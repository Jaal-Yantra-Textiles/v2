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
  rows.push({
    census_id: id, name: `${pick(names)} ${pick(names)}`, gender: g,
    social_group: pick(groups), own_looms: rnd() > 0.5,
    total_looms_worked: Math.floor(rnd() * 4),
    state: "HARYANA", district: "AMBALA", block: "AMBALA",
    mobile: "9" + String(100000000 + Math.floor(rnd() * 899999999)),
    mobile_masked: "91XXXXXXXXXX",
  });
}
mkdirSync("../data/live", { recursive: true });
writeFileSync("../data/live/ambala_full.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} synthetic records to data/live/ambala_full.jsonl`);
