import { ADMIN_MCP_TOOLS } from "../registry"
import { PARTNER_MCP_TOOLS } from "../../../../partners/mcp/lib/registry"
import {
  AdminApproveProductionRunReq,
  AdminCreateProductionRunReq,
} from "../../../production-runs/validators"

/**
 * Two things this suite pins.
 *
 * 1. THE COLLATION IS REACHABLE. One order can hold many runs (#826 S3a), but
 *    there are TWO order ids and they are not interchangeable: `run.order_id`
 *    is the COMMISSIONING order, while the collated work-order holds its runs
 *    through the order↔production_run LINK. Passing a work-order id to
 *    `order_id` matched nothing and returned an empty list — indistinguishable
 *    from "that order has no runs". A model cannot be expected to know that
 *    from a parameter called `order_id`, so the registry has to say it.
 *
 * 2. THE ROW MATCHES ITS VALIDATOR. #1348 and #1361 both bit here: `bodyParams`
 *    is the dispatcher's FORWARD LIST, so a field the schema advertises but the
 *    list omits is silently stripped, and a schema that is laxer than the zod
 *    validator hands the model an unreadable 400 instead of a usable limit.
 */

const admin = (name: string) => ADMIN_MCP_TOOLS.find((t) => t.name === name)
const partner = (name: string) => PARTNER_MCP_TOOLS.find((t) => t.name === name)

describe("collated orders are reachable from an MCP tool", () => {
  const listRuns = admin("list_production_runs")
  const listWorkOrders = admin("list_design_work_orders")

  it("can filter runs by the collated WORK-ORDER, not just the commissioning order", () => {
    expect(listRuns?.queryParams).toContain("work_order_id")
    expect(
      (listRuns?.inputSchema as any)?.properties?.work_order_id
    ).toBeTruthy()
  })

  it("warns that order_id is the commissioning order and will look empty otherwise", () => {
    // The dangerous answer here is a confident empty list.
    const desc = (listRuns?.inputSchema as any)?.properties?.order_id?.description ?? ""
    expect(desc.toLowerCase()).toContain("commissioning")
    expect(desc).toContain("work_order_id")
  })

  it("can find ONE work-order, and can bridge from a customer order to it", () => {
    // Without these the only way to reach a single work-order was to page the
    // whole channel and match by eye.
    expect(listWorkOrders?.queryParams).toEqual(
      expect.arrayContaining(["id", "source_order_id"])
    )
    const props = (listWorkOrders?.inputSchema as any)?.properties ?? {}
    expect(props.id).toBeTruthy()
    expect(props.source_order_id).toBeTruthy()
  })

  it("declares every filter it advertises (a schema-only filter is dropped)", () => {
    const props = Object.keys((listWorkOrders?.inputSchema as any)?.properties ?? {})
    for (const p of props) {
      expect(listWorkOrders?.queryParams).toContain(p)
    }
  })
})

describe("the per-assignment material allocation is callable", () => {
  const create = admin("create_production_run")
  const update = admin("update_production_run")
  const approve = admin("approve_production_run")

  it.each([
    ["create_production_run", create],
    ["update_production_run", update],
  ])("%s forwards materials — a schema-only field is STRIPPED", (_n, tool) => {
    expect((tool?.inputSchema as any)?.properties?.materials).toBeTruthy()
    expect(tool?.bodyParams).toContain("materials")
  })

  it("approve_production_run offers materials PER ASSIGNMENT, not per run", () => {
    // The whole point: two partners on one design can be sent different
    // materials. A run-level field could not express that.
    const items = (approve?.inputSchema as any)?.properties?.assignments?.items
    expect(items?.properties?.materials).toBeTruthy()
    expect(approve?.bodyParams).toContain("assignments")
  })

  it("approve_production_run also offers template_ids, the preferred form (#1268)", () => {
    const items = (approve?.inputSchema as any)?.properties?.assignments?.items
    expect(items?.properties?.template_ids).toBeTruthy()
  })

  describe("the schema mirrors the validator's real limits", () => {
    const materialItem = (admin("create_production_run")?.inputSchema as any)
      ?.properties?.materials?.items

    it("requires inventory_item_id", () => {
      expect(materialItem?.required).toContain("inventory_item_id")
      // …and the validator agrees.
      expect(
        AdminCreateProductionRunReq.safeParse({
          design_id: "design_1",
          materials: [{ planned_quantity: 4 }],
        }).success
      ).toBe(false)
    })

    it("says planned_quantity must be positive, rather than letting a model find out via a 400", () => {
      expect(materialItem?.properties?.planned_quantity?.description).toMatch(
        /positive/i
      )
      expect(
        AdminCreateProductionRunReq.safeParse({
          design_id: "design_1",
          materials: [{ inventory_item_id: "iitem_1", planned_quantity: 0 }],
        }).success
      ).toBe(false)
    })

    it("tells the model the list must be a SUBSET of the design's inventory", () => {
      // The validator cannot check this (it cannot see the BOM), so the
      // description is the only place a model can learn it before the write.
      const desc =
        (admin("create_production_run")?.inputSchema as any)?.properties
          ?.materials?.description ?? ""
      expect(desc.toLowerCase()).toContain("subset")
      expect(desc).toContain("list_design_inventory")
    })

    it("says that omitting it leaves the run unconstrained", () => {
      // Absence is "nobody chose", not "chose nothing" — a model that reads it
      // the other way would think an omitted list forbids everything.
      const desc =
        (admin("update_production_run")?.inputSchema as any)?.properties
          ?.materials?.description ?? ""
      expect(desc.toLowerCase()).toContain("unconstrained")
    })

    it("accepts a well-formed assignment allocation end to end", () => {
      expect(
        AdminApproveProductionRunReq.safeParse({
          assignments: [
            {
              partner_id: "pt_1",
              materials: [{ inventory_item_id: "iitem_1", planned_quantity: 40 }],
            },
          ],
        }).success
      ).toBe(true)
    })

    it("still accepts an assignment with no materials at all", () => {
      expect(
        AdminApproveProductionRunReq.safeParse({
          assignments: [{ partner_id: "pt_1" }],
        }).success
      ).toBe(true)
    })
  })
})

describe("the partner can read what they were assigned", () => {
  it("has a single-run read, which the run list does not cover", () => {
    // log_production_run_consumption points at it; a tool that names a
    // nonexistent tool is the #1348 shape from the other side.
    const get = partner("get_production_run")
    expect(get).toBeTruthy()
    expect(get?.path).toBe("/partners/production-runs/:id")
  })

  it("warns the consumption tool that the run may be constrained", () => {
    const log = partner("log_production_run_consumption")
    expect(log?.description).toMatch(/assigned material list/i)
    expect(log?.description).toMatch(/refused/i)
  })
})
