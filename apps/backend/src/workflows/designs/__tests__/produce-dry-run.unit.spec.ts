import { produceDesignsAsWorkOrder } from "../produce-designs-as-work-order"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"

/**
 * #1803 — the Review step of the collate wizard asks the server what it would
 * do. A dry run that omits the quantity and always answers `work_order_id:
 * null` cannot back that step: null reads as "a new order", which is wrong
 * exactly when collation is doing its job.
 */

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

const openWorkOrder = {
  id: "order_open",
  status: "pending",
  created_at: daysAgo(2),
  metadata: { collated_design_order: true },
  production_runs: [{ id: "run_1" }],
}

const makeContainer = (orders: any[]) => {
  const graph = jest.fn(async (args: any) => {
    if (args.entity === "order") return { data: orders }
    return { data: orders.map((o: any) => ({ order_id: o.id })) }
  })
  const runService = {
    createProductionRuns: jest.fn(),
    updateProductionRuns: jest.fn(),
  }
  return {
    graph,
    runService,
    container: {
      resolve: (key: string) => {
        if (key === "query") return { graph }
        if (key === "logger")
          return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
        if (key === PRODUCTION_RUNS_MODULE) return runService
        return undefined
      },
    } as any,
  }
}

describe("produceDesignsAsWorkOrder — dry run (#1803)", () => {
  it("reports the planned quantity per design, defaulting to 1", async () => {
    const { container } = makeContainer([])

    const result = await produceDesignsAsWorkOrder(
      container,
      ["design_a", "design_b"],
      "partner_1",
      {
        dryRun: true,
        templateIds: ["tpl_1"],
        selections: [{ design_id: "design_a", quantity: 25 }],
      }
    )

    const byDesign = Object.fromEntries(
      (result.designs || []).map((d) => [d.design_id, d])
    )
    expect(byDesign.design_a.quantity).toBe(25)
    // design_b had no selection, so it takes the workflow's own default.
    expect(byDesign.design_b.quantity).toBe(1)
  })

  it("names the work-order the lines would join", async () => {
    const { container } = makeContainer([openWorkOrder])

    const result = await produceDesignsAsWorkOrder(
      container,
      ["design_a"],
      "partner_1",
      { dryRun: true, templateIds: ["tpl_1"] }
    )

    expect(result.work_order_id).toBe("order_open")
    expect(result.work_order_joined).toBe(true)
  })

  it("reports a new work-order when the partner has nothing open to join", async () => {
    const { container } = makeContainer([])

    const result = await produceDesignsAsWorkOrder(
      container,
      ["design_a"],
      "partner_1",
      { dryRun: true, templateIds: ["tpl_1"] }
    )

    expect(result.work_order_id).toBeNull()
    expect(result.work_order_joined).toBe(false)
  })

  it("does not look for an open order when the batch must be billed on its own", async () => {
    const { container, graph } = makeContainer([openWorkOrder])

    const result = await produceDesignsAsWorkOrder(
      container,
      ["design_a"],
      "partner_1",
      { dryRun: true, templateIds: ["tpl_1"], collate: "new" }
    )

    expect(result.work_order_id).toBeNull()
    expect(result.work_order_joined).toBe(false)
    expect(graph).not.toHaveBeenCalled()
  })

  it("creates nothing", async () => {
    const { container, runService } = makeContainer([openWorkOrder])

    const result = await produceDesignsAsWorkOrder(
      container,
      ["design_a", "design_b"],
      "partner_1",
      { dryRun: true, templateIds: ["tpl_1"] }
    )

    expect(result.dry_run).toBe(true)
    expect(result.created).toBe(0)
    expect(result.run_ids).toEqual([])
    expect(result.design_ids).toEqual([])
    expect(runService.createProductionRuns).not.toHaveBeenCalled()
  })

  it("flags a design with no templates rather than reporting it as ready", async () => {
    const { container } = makeContainer([])

    const result = await produceDesignsAsWorkOrder(
      container,
      ["design_a"],
      "partner_1",
      { dryRun: true }
    )

    const [row] = result.designs || []
    expect(row.template_ids).toEqual([])
    expect(row.reason).toMatch(/no templates selected/)
  })
})
