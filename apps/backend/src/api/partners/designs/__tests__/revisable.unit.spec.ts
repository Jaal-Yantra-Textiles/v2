import {
  isDesignRevisable,
  REVISABLE_STATUSES,
} from "../[designId]/revise/revisable"

describe("isDesignRevisable (#337 partner design revise)", () => {
  it("returns true for every revisable status", () => {
    for (const status of REVISABLE_STATUSES) {
      expect(isDesignRevisable(status)).toBe(true)
    }
  })

  it("returns false for a non-revisable status (e.g. Conceptual/Rejected)", () => {
    expect(isDesignRevisable("Conceptual")).toBe(false)
    expect(isDesignRevisable("Rejected")).toBe(false)
    expect(isDesignRevisable("Superseded")).toBe(false)
  })

  it("returns false for null/undefined/empty status (no crash)", () => {
    expect(isDesignRevisable(null)).toBe(false)
    expect(isDesignRevisable(undefined)).toBe(false)
    expect(isDesignRevisable("")).toBe(false)
  })

  it("is case-sensitive (matches the workflow's exact-string check)", () => {
    expect(isDesignRevisable("approved")).toBe(false)
    expect(isDesignRevisable("APPROVED")).toBe(false)
    expect(isDesignRevisable("Approved")).toBe(true)
  })

  it("mirrors the workflow's REVISABLE_STATUSES set exactly", () => {
    // Guards against drift from src/workflows/designs/revise-design.ts
    expect([...REVISABLE_STATUSES].sort()).toEqual(
      [
        "Approved",
        "Commerce_Ready",
        "In_Development",
        "Sample_Production",
        "Technical_Review",
      ].sort()
    )
  })
})
