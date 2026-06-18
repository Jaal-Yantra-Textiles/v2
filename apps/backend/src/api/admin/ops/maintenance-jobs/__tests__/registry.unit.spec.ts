import {
  diffCostFields,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
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
