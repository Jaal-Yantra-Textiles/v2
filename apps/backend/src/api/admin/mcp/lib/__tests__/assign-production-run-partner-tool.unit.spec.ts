import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * `assign_production_run_partner` — the single-run way to move ownership.
 *
 * It exists because `update_production_run` deliberately DROPS `partner_id`,
 * which left the agent surface unable to un-park a run at all: on 2026-09-21 a
 * run that had been auto-reassigned away from Ksaman Naturals could only be
 * recovered through the batch redispatch tool, and only because that tool
 * happens to send work back to `previous_partner_id`. There was no way to give
 * a run to a DIFFERENT partner.
 */
describe("assign_production_run_partner tool", () => {
  const tool = ADMIN_MCP_TOOLS.find(
    (t: any) => t.name === "assign_production_run_partner"
  ) as any

  it("is registered", () => {
    expect(tool).toBeDefined()
  })

  it("wraps the guarded assign-partner route, not the generic update", () => {
    /*
     * 🔴 The generic PUT would skip the assignment workflow, the policy's
     * assign_partner_from check and the activity-feed record. Ownership is not
     * a field edit.
     */
    expect(tool.method).toBe("POST")
    expect(tool.path).toBe("/admin/production-runs/:id/assign-partner")
    expect(tool.pathParams).toEqual(["id"])
  })

  it("is a sensitive write, so it cannot fire without confirmation", () => {
    expect(tool.write).toBe(true)
    expect(tool.sensitive).toBe(true)
  })

  it("forwards exactly the two fields the route validates", () => {
    // AdminAssignProductionRunPartnerReq = { partner_id, note? }. Anything
    // else silently dropped is worse than rejected.
    expect(tool.bodyParams).toEqual(["partner_id", "note"])
  })

  it("requires id and partner_id", () => {
    expect(tool.inputSchema.required).toEqual(["id", "partner_id"])
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual([
      "id",
      "note",
      "partner_id",
    ])
  })

  it("🔴 says out loud that it messages nobody", () => {
    /*
     * The trap this tool sets for its caller: the run lands on `approved`, so
     * an operator who stops here believes the partner has been told and the
     * partner has heard nothing. Same family as assign-partner vs
     * send-to-partner generally.
     */
    expect(tool.sideEffects).toMatch(/Tells the partner NOTHING/i)
    expect(tool.description).toMatch(/approved/)
    expect(tool.description).toMatch(/NOT `sent_to_partner`/)
  })

  it("points at dispatch as the next step", () => {
    expect(tool.nextSteps).toContain("send_production_run_to_production")
  })

  it("has a previewPath so dry-run shows the run before it moves", () => {
    expect(tool.previewPath).toBe("/admin/production-runs/:id")
  })
})
