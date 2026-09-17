/**
 * #2111 S1 — the supply → run edge, as the AGENT can see it.
 *
 * `depends_on_inventory_order_ids` has been modelled, gated, guarded and
 * released since #1529. What was missing was narrower and completely invisible
 * from inside the repo's own gates: **no MCP tool advertised it**, so nothing an
 * assistant created could ever wait on arriving goods.
 *
 * 🔴 Why `route-validator-field-coverage.unit.spec.ts` did not catch it.
 * That file walks a tool's TOP-LEVEL properties against its route validator.
 * This field lives inside `assignments[].items`, and a field nested in an array
 * item is unchecked there by construction. So the gap was not "nobody looked" —
 * it was "the thing that looks, cannot see here". These assertions reach into
 * the item schema deliberately, because that is where the field lives.
 *
 * The other half of the pair, `depends_on_run_ids`, is DERIVED at approval from
 * the assignment `order` and is settable by no route at all. Advertising it as
 * an input would be a lie that returns 200, so its absence is asserted too.
 */

import { ADMIN_MCP_TOOLS } from "../registry"
import { AdminCreateDesignProductionRunSchema } from "../../../designs/[id]/production-runs/validators"
import { AdminApproveProductionRunReq } from "../../../production-runs/validators"

const tool = (name: string) => {
  const found = ADMIN_MCP_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`No such admin MCP tool: ${name}`)
  return found as any
}

/** The `assignments[]` item schema of a tool that carries one. */
const assignmentItemProps = (name: string): Record<string, any> =>
  tool(name).inputSchema?.properties?.assignments?.items?.properties ?? {}

const DEP = "depends_on_inventory_order_ids"

describe("#2111 S1 — run dependencies are advertised where they can be SET", () => {
  describe("the three write paths that reach the field", () => {
    it("approve_production_run offers it per assignment — the path the backend already accepted", () => {
      expect(assignmentItemProps("approve_production_run")[DEP]).toBeDefined()
    })

    it("create_design_production_run offers it per assignment", () => {
      expect(assignmentItemProps("create_design_production_run")[DEP]).toBeDefined()
    })

    it("update_production_run offers it, and declares it in bodyParams", () => {
      // Both matter: `inputSchema` is what the model is shown, `bodyParams` is
      // the allowlist the dispatcher picks the outgoing body from. A field in
      // one and not the other is advertised-and-dropped, or sent-and-unshown.
      expect(tool("update_production_run").inputSchema.properties[DEP]).toBeDefined()
      expect(tool("update_production_run").bodyParams).toContain(DEP)
    })

    it("every advertisement says Delivered, and says it is not the run-to-run edge", () => {
      const texts = [
        assignmentItemProps("approve_production_run")[DEP].description,
        assignmentItemProps("create_design_production_run")[DEP].description,
        tool("update_production_run").inputSchema.properties[DEP].description,
      ]
      for (const text of texts) {
        // `Shipped` only says the goods left the supplier. A partner cannot cut
        // cloth that is in a van, and the gate agrees — INVENTORY_DEPENDENCY_MET_STATUS.
        expect(text).toContain("Delivered")
        expect(text).toContain("NOT interchangeable")
      }
    })
  })

  describe("where it is deliberately NOT offered", () => {
    it("create_production_run does not offer it, and says why", () => {
      // The parent it creates is `pending_review`, and the release subscriber's
      // candidate set is `status: 'approved'` — a dependency written here would
      // never be read by anything.
      expect(tool("create_production_run").inputSchema.properties[DEP]).toBeUndefined()
      expect(tool("create_production_run").description).toContain("pending_review")
      expect(tool("create_production_run").description).toContain("approve_production_run")
    })

    it("no tool anywhere advertises depends_on_run_ids as an input", () => {
      // It is computed from the assignment `order` in approve-production-run.ts.
      // Offering it would accept a value the backend silently discards.
      const offenders = ADMIN_MCP_TOOLS.filter((t: any) =>
        JSON.stringify(t.inputSchema?.properties ?? {}).includes(
          '"depends_on_run_ids"'
        )
      ).map((t: any) => t.name)
      expect(offenders).toEqual([])
    })

    it("the `order` field is documented as the run-to-run edge, on both tools that take assignments", () => {
      for (const name of ["approve_production_run", "create_design_production_run"]) {
        expect(assignmentItemProps(name).order.description).toContain(
          "depends_on_run_ids"
        )
      }
    })
  })

  /**
   * The advertisement is worthless if the route strips the field. Both schemas
   * are the REAL ones the routes register, so deleting either declaration turns
   * these red — which is the failure mode that produced this slice: the design
   * route's handler passed `assignments` to the workflow verbatim, the workflow
   * had understood the field since #1529, and the schema was the wall.
   */
  describe("the validators actually accept what the tools advertise", () => {
    const assignment = {
      partner_id: "partner_1",
      quantity: 2,
      [DEP]: ["inv_order_1", "inv_order_2"],
    }

    it("the design-route schema keeps it (it used to strip it)", () => {
      const parsed = AdminCreateDesignProductionRunSchema.parse({
        quantity: 2,
        assignments: [assignment],
      })
      expect(parsed.assignments?.[0][DEP]).toEqual(["inv_order_1", "inv_order_2"])
    })

    it("the approve schema keeps it", () => {
      const parsed = AdminApproveProductionRunReq.parse({
        assignments: [{ partner_id: "partner_1", [DEP]: ["inv_order_1"] }],
      })
      expect((parsed.assignments as any)?.[0][DEP]).toEqual(["inv_order_1"])
    })

    it("both accept null — the admin UI's 'toggle on, nothing picked'", () => {
      expect(
        AdminApproveProductionRunReq.parse({
          assignments: [{ partner_id: "p", [DEP]: null }],
        })
      ).toBeTruthy()
      expect(
        AdminCreateDesignProductionRunSchema.parse({
          assignments: [{ partner_id: "p", quantity: 1, [DEP]: null }],
        })
      ).toBeTruthy()
    })

    it("both reject an empty-string id rather than storing a dependency that can never be met", () => {
      // An unreadable dependency counts as UNMET forever, so a blank id is a
      // permanent stall wearing the clothes of a wait.
      expect(() =>
        AdminApproveProductionRunReq.parse({
          assignments: [{ partner_id: "p", [DEP]: [""] }],
        })
      ).toThrow()
      expect(() =>
        AdminCreateDesignProductionRunSchema.parse({
          assignments: [{ partner_id: "p", quantity: 1, [DEP]: [""] }],
        })
      ).toThrow()
    })
  })
})
