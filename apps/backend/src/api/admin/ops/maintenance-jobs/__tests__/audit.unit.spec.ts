import { buildAuditRow } from "../audit"
import type { MaintenanceJobResult } from "../registry"

// Pure unit coverage for the audit-row mapper (#457). No DB — only the
// result → persistable-row mapping for each run shape.
describe("ops/maintenance-jobs buildAuditRow (#457)", () => {
  const params = { design_id: "design_123" }

  it("maps a dry-run preview (no changes applied)", () => {
    const result: MaintenanceJobResult = {
      job_id: "recalculate-design-cost",
      dry_run: true,
      applied: false,
      summary: "Would update 1 field(s) on design design_123",
      changes: [
        { entity: "design", id: "design_123", field: "estimated_cost", before: 10, after: 20 },
      ],
    }

    const row = buildAuditRow(result, "user_abc", params)

    expect(row).toEqual({
      job_id: "recalculate-design-cost",
      actor_id: "user_abc",
      dry_run: true,
      applied: false,
      change_count: 1,
      error_count: 0,
      summary: "Would update 1 field(s) on design design_123",
      params,
      changes: result.changes,
      errors: [],
    })
  })

  it("maps an apply-with-changes run", () => {
    const result: MaintenanceJobResult = {
      job_id: "recalculate-design-cost",
      dry_run: false,
      applied: true,
      summary: "Updated 2 field(s) on design design_123",
      changes: [
        { entity: "design", id: "design_123", field: "material_cost", before: 1, after: 2 },
        { entity: "design", id: "design_123", field: "production_cost", before: 3, after: 4 },
      ],
    }

    const row = buildAuditRow(result, "user_abc", params)

    expect(row.dry_run).toBe(false)
    expect(row.applied).toBe(true)
    expect(row.change_count).toBe(2)
    expect(row.error_count).toBe(0)
    expect(row.errors).toEqual([])
  })

  it("maps a no-op apply (applied=false, zero changes)", () => {
    const result: MaintenanceJobResult = {
      job_id: "recalculate-design-cost",
      dry_run: false,
      applied: false,
      summary: "No changes — design design_123 cost already up to date",
      changes: [],
    }

    const row = buildAuditRow(result, "unknown", params)

    expect(row.applied).toBe(false)
    expect(row.change_count).toBe(0)
    expect(row.error_count).toBe(0)
    expect(row.actor_id).toBe("unknown")
  })

  it("carries per-entity errors from a bulk run", () => {
    const result: MaintenanceJobResult = {
      job_id: "recalculate-design-cost-bulk",
      dry_run: false,
      applied: true,
      summary: "Updated 1 field(s) across 1/2 design(s); 1 error(s)",
      changes: [
        { entity: "design", id: "design_ok", field: "estimated_cost", before: 5, after: 9 },
      ],
      errors: [{ id: "design_gone", message: "Design not found: design_gone" }],
    }

    const row = buildAuditRow(result, "user_abc", { design_ids: ["design_ok", "design_gone"] })

    expect(row.change_count).toBe(1)
    expect(row.error_count).toBe(1)
    expect(row.errors).toEqual([{ id: "design_gone", message: "Design not found: design_gone" }])
  })
})
