import {
  diffCostFields,
  diffRunCostFields,
  getMaintenanceJob,
  interpretRunCost,
  MAINTENANCE_JOBS,
  MAX_BULK_DESIGNS,
  parseDesignIds,
  summarizeBulkRecalc,
} from "../registry"

// Pure unit coverage for the maintenance-job registry (#457). No DB / workflow
// boot — only the dry-run/apply diff logic and registry lookup.
describe("ops/maintenance-jobs registry (#457)", () => {
  describe("getMaintenanceJob", () => {
    it("resolves a registered job by id", () => {
      const job = getMaintenanceJob("recalculate-design-cost")
      expect(job).toBeDefined()
      expect(job?.id).toBe("recalculate-design-cost")
      expect(job?.params.some((p) => p.name === "design_id" && p.required)).toBe(true)
    })

    it("returns undefined for an unknown job", () => {
      expect(getMaintenanceJob("does-not-exist")).toBeUndefined()
    })

    it("exposes at least the recalculate-design-cost job", () => {
      expect(MAINTENANCE_JOBS.map((j) => j.id)).toContain("recalculate-design-cost")
    })

    it("registers the bulk recalculate job with a required design_ids param", () => {
      const job = getMaintenanceJob("recalculate-design-cost-bulk")
      expect(job).toBeDefined()
      expect(job?.params.some((p) => p.name === "design_ids" && p.required)).toBe(true)
    })

    it("registers the correct-production-run-cost job with a required run id param", () => {
      const job = getMaintenanceJob("correct-production-run-cost")
      expect(job).toBeDefined()
      expect(job?.params.some((p) => p.name === "production_run_id" && p.required)).toBe(true)
      // cost fields are optional (caller supplies at least one)
      expect(job?.params.some((p) => p.name === "partner_cost_estimate" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "cost_type" && !p.required)).toBe(true)
    })
  })

  describe("interpretRunCost (#456 per-unit × qty trap)", () => {
    it("expands a per_unit estimate to its total over the run quantity", () => {
      expect(interpretRunCost(7650, "per_unit", 9)).toEqual({ per_unit: 7650, total: 68850 })
    })

    it("divides a total estimate down to per-unit over the run quantity", () => {
      expect(interpretRunCost(68850, "total", 9)).toEqual({ per_unit: 7650, total: 68850 })
    })

    it("defaults to 'total' interpretation when cost_type is null/undefined", () => {
      expect(interpretRunCost(100, null, 4)).toEqual({ per_unit: 25, total: 100 })
      expect(interpretRunCost(100, undefined, 4)).toEqual({ per_unit: 25, total: 100 })
    })

    it("treats a non-positive quantity as 1 (no divide-by-zero)", () => {
      expect(interpretRunCost(100, "total", 0)).toEqual({ per_unit: 100, total: 100 })
      expect(interpretRunCost(100, "per_unit", 0)).toEqual({ per_unit: 100, total: 100 })
    })

    it("returns nulls when no estimate is set", () => {
      expect(interpretRunCost(null, "total", 9)).toEqual({ per_unit: null, total: null })
      expect(interpretRunCost(undefined, "per_unit", 9)).toEqual({ per_unit: null, total: null })
    })
  })

  describe("diffRunCostFields", () => {
    it("only considers fields the caller supplied (omitted = untouched)", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 100, cost_type: "total" },
        { cost_type: "per_unit" }
      )
      expect(changes).toEqual([
        { entity: "production_run", id: "prod_run_1", field: "cost_type", before: "total", after: "per_unit" },
      ])
    })

    it("reports a change for both fields when corrected together", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 68850, cost_type: "total" },
        { partner_cost_estimate: 7650, cost_type: "per_unit" }
      )
      expect(changes).toEqual(
        expect.arrayContaining([
          { entity: "production_run", id: "prod_run_1", field: "partner_cost_estimate", before: 68850, after: 7650 },
          { entity: "production_run", id: "prod_run_1", field: "cost_type", before: "total", after: "per_unit" },
        ])
      )
      expect(changes).toHaveLength(2)
    })

    it("returns no changes when the requested values already match (idempotent)", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 100, cost_type: "total" },
        { partner_cost_estimate: 100, cost_type: "total" }
      )
      expect(changes).toEqual([])
    })

    it("treats null as a real 'clear the estimate' change, distinct from omitted", () => {
      const cleared = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 100, cost_type: "total" },
        { partner_cost_estimate: null }
      )
      expect(cleared).toEqual([
        { entity: "production_run", id: "prod_run_1", field: "partner_cost_estimate", before: 100, after: null },
      ])
    })

    it("coerces string-typed persisted decimals before comparing", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: "100" as any, cost_type: "total" },
        { partner_cost_estimate: 100 }
      )
      expect(changes).toEqual([])
    })
  })

  describe("parseDesignIds", () => {
    it("accepts an array of ids", () => {
      expect(parseDesignIds(["d_1", "d_2"])).toEqual(["d_1", "d_2"])
    })

    it("accepts a comma/whitespace/newline-separated string", () => {
      expect(parseDesignIds("d_1, d_2\nd_3  d_4")).toEqual(["d_1", "d_2", "d_3", "d_4"])
    })

    it("trims, drops blanks, and de-duplicates while preserving order", () => {
      expect(parseDesignIds([" d_1 ", "d_2", "", "d_1"])).toEqual(["d_1", "d_2"])
    })

    it("throws INVALID_DATA when no usable id is present", () => {
      expect(() => parseDesignIds("  ,  ")).toThrow(/at least one/)
      expect(() => parseDesignIds([])).toThrow(/at least one/)
    })

    it("throws INVALID_DATA for a non-string/array input", () => {
      expect(() => parseDesignIds(undefined)).toThrow(/required/)
      expect(() => parseDesignIds(42 as any)).toThrow(/required/)
    })

    it("rejects more ids than the per-request cap", () => {
      const tooMany = Array.from({ length: MAX_BULK_DESIGNS + 1 }, (_, i) => `d_${i}`)
      expect(() => parseDesignIds(tooMany)).toThrow(/limit of/)
    })

    it("allows exactly the cap", () => {
      const atCap = Array.from({ length: MAX_BULK_DESIGNS }, (_, i) => `d_${i}`)
      expect(parseDesignIds(atCap)).toHaveLength(MAX_BULK_DESIGNS)
    })
  })

  describe("summarizeBulkRecalc", () => {
    it("reports no changes when nothing drifted", () => {
      expect(summarizeBulkRecalc(true, 3, 0, 0, 0)).toMatch(/No changes — 3 design/)
    })

    it("uses 'Would update' for dry-run and counts changed designs", () => {
      expect(summarizeBulkRecalc(true, 5, 2, 4, 0)).toBe(
        "Would update 4 field(s) across 2/5 design(s)"
      )
    })

    it("uses 'Updated' on apply and appends an error count when present", () => {
      expect(summarizeBulkRecalc(false, 5, 2, 4, 1)).toBe(
        "Updated 4 field(s) across 2/5 design(s); 1 error(s)"
      )
    })
  })

  describe("diffCostFields", () => {
    const after = { total_estimated: 100, material_cost: 70, production_cost: 30 }

    it("reports a change for every field when nothing is persisted yet (null → value)", () => {
      const changes = diffCostFields("design_1", {}, after)
      expect(changes).toHaveLength(3)
      expect(changes).toEqual(
        expect.arrayContaining([
          { entity: "design", id: "design_1", field: "estimated_cost", before: null, after: 100 },
          { entity: "design", id: "design_1", field: "material_cost", before: null, after: 70 },
          { entity: "design", id: "design_1", field: "production_cost", before: null, after: 30 },
        ])
      )
    })

    it("returns no changes when persisted values already match (idempotent apply)", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: 100, material_cost: 70, production_cost: 30 },
        after
      )
      expect(changes).toEqual([])
    })

    it("only reports the fields that actually differ", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: 100, material_cost: 60, production_cost: 30 },
        after
      )
      expect(changes).toEqual([
        { entity: "design", id: "design_1", field: "material_cost", before: 60, after: 70 },
      ])
    })

    it("coerces string-typed persisted decimals before comparing", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: "100" as any, material_cost: "70" as any, production_cost: "30" as any },
        after
      )
      expect(changes).toEqual([])
    })

    it("treats null and 0 as distinct (null is unset, 0 is a real value)", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: 100, material_cost: 70, production_cost: null },
        after
      )
      expect(changes).toEqual([
        { entity: "design", id: "design_1", field: "production_cost", before: null, after: 30 },
      ])
    })
  })
})
