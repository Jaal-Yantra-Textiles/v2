import fs from "fs"
import path from "path"

import {
  CLASSIFIED,
  classifyPair,
  describePair,
  type PairMeasurement,
} from "../audit-dangling-links-job"

/**
 * #1857 — the re-ranked sweep.
 *
 * The first two sweeps ranked by row count and put two NON-defects on top. The
 * classification table is what fixes that, and it is also the only part of
 * this job that can rot: every entry is a claim about code that may change
 * under it. A stale entry does not fail loudly — it makes the sweep go QUIET
 * about a real defect, which is the one outcome an audit must never have.
 */

const measure = (over: Partial<PairMeasurement> = {}): PairMeasurement => ({
  table: "some_table",
  column: "some_id",
  target: "some",
  total: 10,
  orphans: 3,
  ...over,
})

describe("classifyPair", () => {
  it("returns unexplained for anything not in the table", () => {
    expect(classifyPair("payment_schedule", "cart_id")).toBe("unexplained")
  })

  it("recognises the two tombstones that topped the previous sweeps", () => {
    // Neither is a defect: revoke DELETES the price list, and a variant price
    // save replaces the whole price set.
    expect(classifyPair("partner_quote", "price_list_id")).toBe("tombstone")
    expect(
      classifyPair("pricing_price_fx_rates_fx_price_meta", "price_id")
    ).toBe("tombstone")
  })

  it("recognises the external ids that measured 100%", () => {
    expect(classifyPair("lead", "form_id")).toBe("external_id")
    expect(classifyPair("conversion", "analytics_session_id")).toBe("external_id")
  })
})

describe("describePair", () => {
  it("calls out a 100% rate as the external-id signature", () => {
    /*
     * 🔴 The line has to say this. Every known false positive measured 100%,
     * and without it the next reader ranks `conversion.analytics_session_id`
     * (1934 of 1934) first all over again.
     */
    const note = describePair(
      measure({ table: "lead", column: "form_id", target: "form", total: 230, orphans: 230 }),
      "external_id"
    )
    expect(note).toContain("100%")
    expect(note).toContain("never pointed here")
  })

  it("does not claim that shape for a partial rate", () => {
    const note = describePair(measure({ total: 10, orphans: 3 }), "unexplained")
    expect(note).toContain("3 of 10")
    expect(note).toContain("30%")
    expect(note).not.toContain("never pointed here")
  })

  it("survives a pair with no rows rather than dividing by zero", () => {
    expect(describePair(measure({ total: 0, orphans: 0 }), "unexplained")).toContain("(0%)")
  })
})

describe("the classification table cannot rot silently", () => {
  const repoSrc = path.resolve(__dirname, "../../../../..")

  it("every entry gives a reason", () => {
    for (const [key, value] of Object.entries(CLASSIFIED)) {
      expect(`${key}: ${value.reason}`.length).toBeGreaterThan(key.length + 30)
    }
  })

  it("every file a tombstone cites still exists", () => {
    /*
     * 🔴 An audit verdict is a claim about the PAST. A previous verdict sweep
     * in this repo cited eleven files and four of them had been deleted. A
     * tombstone entry whose cited file is gone is an explanation nobody can
     * check, sitting in front of rows the sweep has stopped reporting.
     *
     * This does not prove the behaviour is unchanged — only a reader can do
     * that. It catches the cheapest and commonest rot: the file moved.
     */
    const cited = Object.values(CLASSIFIED)
      .flatMap((c) => c.reason.match(/[\w./-]+\.ts/g) ?? [])
      .filter((p) => p.includes("/"))

    expect(cited.length).toBeGreaterThan(0)
    for (const rel of cited) {
      expect({ rel, exists: fs.existsSync(path.join(repoSrc, rel)) }).toEqual({
        rel,
        exists: true,
      })
    }
  })

  it("keys are `table.column`, so a typo cannot silently match nothing", () => {
    for (const key of Object.keys(CLASSIFIED)) {
      expect(key).toMatch(/^[a-z0-9_-]+\.[a-z0-9_]+_id$/)
    }
  })
})
