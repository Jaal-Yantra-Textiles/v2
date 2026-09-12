/**
 * Unit tests for the pure partner design-brief shaper (roadmap #604, slice C).
 * Mirrors the admin slice-B shape so partner-ui + admin-ui see identical bodies.
 *
 * Run:
 *   TEST_TYPE=unit pnpm jest apps/backend/src/api/partners/designs/__tests__/brief-shaper.unit.spec.ts
 */
import {
  DESIGN_BRIEF_FIELDS,
  pickDesignBrief,
} from "../[designId]/brief/validators"

describe("pickDesignBrief (partner #604 slice C)", () => {
  it("returns null for a missing design", () => {
    expect(pickDesignBrief(undefined)).toBeNull()
    expect(pickDesignBrief(null)).toBeNull()
  })

  /**
   * 🔑 The guard that stops this file going stale again.
   *
   * These tests listed the brief's fields by hand, so when #1113 S2 added
   * `aesthetic_keywords` and `milestones` to the contract the shaper grew two
   * keys the expectations did not have — and the suite went red for a defect
   * that did not exist, on `main`, for as long as nobody edited this file.
   *
   * Pinning the shape to `DESIGN_BRIEF_FIELDS` instead means the next added
   * column fails HERE, saying which key is missing, and only when the shaper
   * genuinely forgot it.
   */
  it("returns exactly the declared brief fields, no more and no fewer", () => {
    const shaped = pickDesignBrief({ id: "design_0" })!
    expect(Object.keys(shaped).sort()).toEqual([...DESIGN_BRIEF_FIELDS].sort())
  })

  it("coerces all-unset columns to a fully-null brief", () => {
    expect(pickDesignBrief({ id: "design_1" })).toEqual({
      concept_theme: null,
      aesthetic_keywords: null,
      persona: null,
      competitors: null,
      price_point: null,
      design_budget: null,
      cost_currency: null,
      milestones: null,
    })
  })

  it("passes through populated brief fields and numifies the bigNumber budget", () => {
    const persona = { age_range: "25-34", values: ["sustainable"] }
    const competitors = [{ name: "Acme", differentiator: "cheaper" }]
    // #1113 S2 — the two fields backing the moodboard brief-anchor cards.
    const aesthetic_keywords = ["airy", "sun-bleached", "unfussy"]
    const milestones = [{ label: "First sample", date: "2026-10-01" }]
    expect(
      pickDesignBrief({
        id: "design_2",
        concept_theme: "Coastal minimalism",
        aesthetic_keywords,
        persona,
        competitors,
        price_point: "luxury",
        design_budget: "1500", // bigNumber arrives as string
        cost_currency: "inr",
        milestones,
        // extraneous columns must be dropped
        name: "should-not-leak",
        status: "in_progress",
      })
    ).toEqual({
      concept_theme: "Coastal minimalism",
      aesthetic_keywords,
      persona,
      competitors,
      price_point: "luxury",
      design_budget: 1500,
      cost_currency: "inr",
      milestones,
    })
  })

  it("treats a zero budget as the number 0, not null", () => {
    expect(pickDesignBrief({ id: "d", design_budget: 0 })?.design_budget).toBe(0)
  })

  it("keeps null budget null (not NaN)", () => {
    expect(pickDesignBrief({ id: "d", design_budget: null })?.design_budget).toBeNull()
  })
})
