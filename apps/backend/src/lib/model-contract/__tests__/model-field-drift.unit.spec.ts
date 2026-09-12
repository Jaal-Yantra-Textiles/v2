import fs from "fs"
import path from "path"

import { collectModelContracts, type ModelContract } from "../collect"

/**
 * THE MODEL-DRIFT GUARD.
 *
 * 🔑 What it is for: making the test suite AWARE that a model changed, instead
 * of finding out through an unrelated spec going stale months later.
 *
 * On 2026-09-12 the full unit suite (which CI had never run — PRs run only the
 * specs whose files changed) had five failures on `main`. Three were the same
 * species: code grew a field, a hand-written field list did not, and nothing
 * connected the two. The worst was the design brief, whose 8 columns were
 * restated in FOUR places — `pickDesignBrief`'s return literal,
 * `DESIGN_BRIEF_FIELDS`, a byte-identical copy under the admin route, and the
 * spec's expectations — none of which knew about the `design` model.
 *
 * So: one test that fails LOUDLY and EXACTLY ONCE when any model gains or loses
 * a column, naming the model, the file and the field. It does not assert the
 * change is wrong — most are intended. It asserts you SAW it, and pushes you to
 * the consumers that restate that model's shape.
 *
 * To accept a legitimate model change:
 *     pnpm models:snapshot
 * then read the diff before committing it — that diff IS the review.
 */

const SNAPSHOT = path.resolve(__dirname, "..", "model-fields.json")

type Snapshot = Record<string, { file: string; fields: string[] }>

const toSnapshot = (contracts: ModelContract[]): Snapshot => {
  const out: Snapshot = {}
  for (const c of contracts) {
    // Keyed by model + file: two modules may legitimately define a table name
    // that reads the same, and collapsing them would hide one of the two.
    out[`${c.model} (${c.file})`] = { file: c.file, fields: c.fields }
  }
  return out
}

const { contracts, unreadable } = collectModelContracts()
const current = toSnapshot(contracts)

if (process.env.UPDATE_MODEL_FIELDS === "1") {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(current, null, 2) + "\n")
}

describe("model field drift", () => {
  it("finds the models at all (the guard must not pass by finding nothing)", () => {
    // 🔴 An empty walk would make every assertion below vacuously true — the
    // exact failure mode where a check that never ran reads as a pass.
    expect(contracts.length).toBeGreaterThan(100)
  })

  it("can import every model file", () => {
    expect(unreadable).toEqual([])
  })

  it("matches the committed contract — no model gained or lost a field", () => {
    expect(fs.existsSync(SNAPSHOT)).toBe(true)
    const committed: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"))

    const added: string[] = []
    const removed: string[] = []
    const changed: string[] = []

    for (const key of Object.keys(current)) {
      if (!committed[key]) {
        added.push(key)
        continue
      }
      const before = new Set(committed[key].fields)
      const after = new Set(current[key].fields)
      const gained = [...after].filter((f) => !before.has(f))
      const lost = [...before].filter((f) => !after.has(f))
      if (gained.length || lost.length) {
        changed.push(
          `${key}\n      gained: ${gained.join(", ") || "(none)"}\n      lost:   ${lost.join(", ") || "(none)"}`
        )
      }
    }
    for (const key of Object.keys(committed)) {
      if (!current[key]) removed.push(key)
    }

    const problems = [
      changed.length ? `CHANGED MODELS:\n    ${changed.join("\n    ")}` : "",
      added.length ? `NEW MODELS:\n    ${added.join("\n    ")}` : "",
      removed.length ? `GONE MODELS:\n    ${removed.join("\n    ")}` : "",
    ].filter(Boolean)

    if (problems.length) {
      throw new Error(
        `A data model changed shape.\n\n${problems.join("\n\n")}\n\n` +
          `This is not necessarily wrong — most model changes are intended. What it means is that\n` +
          `anything RESTATING this model's fields may now be stale, and nothing else will tell you:\n` +
          `  · response shapers (pick*/summarise*/build*Row) that list keys by hand\n` +
          `  · *_FIELDS / *_GRAPH_FIELDS constants used as query selectors\n` +
          `  · zod validators mirroring the columns\n` +
          `  · tests asserting a whole object with toEqual\n\n` +
          `Check those, then accept the change with:  pnpm models:snapshot\n` +
          `and review the resulting diff — that diff is the record of what changed.`
      )
    }
  })
})
