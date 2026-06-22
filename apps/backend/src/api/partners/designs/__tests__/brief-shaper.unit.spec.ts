/**
 * Unit tests for the pure partner design-brief shaper (roadmap #604, slice C).
 * Mirrors the admin slice-B shape so partner-ui + admin-ui see identical bodies.
 *
 * Run:
 *   TEST_TYPE=unit pnpm jest apps/backend/src/api/partners/designs/__tests__/brief-shaper.unit.spec.ts
 */
import { pickDesignBrief } from "../[designId]/brief/validators"

describe("pickDesignBrief (partner #604 slice C)", () => {
  it("returns null for a missing design", () => {
    expect(pickDesignBrief(undefined)).toBeNull()
    expect(pickDesignBrief(null)).toBeNull()
  })

  it("coerces all-unset columns to a fully-null brief", () => {
    expect(pickDesignBrief({ id: "design_1" })).toEqual({
      concept_theme: null,
      persona: null,
      competitors: null,
      price_point: null,
      design_budget: null,
      cost_currency: null,
    })
  })

  it("passes through populated brief fields and numifies the bigNumber budget", () => {
    const persona = { age_range: "25-34", values: ["sustainable"] }
    const competitors = [{ name: "Acme", differentiator: "cheaper" }]
    expect(
      pickDesignBrief({
        id: "design_2",
        concept_theme: "Coastal minimalism",
        persona,
        competitors,
        price_point: "luxury",
        design_budget: "1500", // bigNumber arrives as string
        cost_currency: "inr",
        // extraneous columns must be dropped
        name: "should-not-leak",
        status: "in_progress",
      })
    ).toEqual({
      concept_theme: "Coastal minimalism",
      persona,
      competitors,
      price_point: "luxury",
      design_budget: 1500,
      cost_currency: "inr",
    })
  })

  it("treats a zero budget as the number 0, not null", () => {
    expect(pickDesignBrief({ id: "d", design_budget: 0 })?.design_budget).toBe(0)
  })

  it("keeps null budget null (not NaN)", () => {
    expect(pickDesignBrief({ id: "d", design_budget: null })?.design_budget).toBeNull()
  })
})
