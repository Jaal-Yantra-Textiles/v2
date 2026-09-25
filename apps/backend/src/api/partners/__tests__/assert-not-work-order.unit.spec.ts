/**
 * #2265 S3a — retail-only partner order actions refuse work orders.
 *
 * `validatePartnerOrderOwnership` admits work orders on purpose (the D3 link),
 * so without this a partner could POST /partners/orders/:id/cancel on a design
 * work order and run core `cancelOrderWorkflow` (order.canceled → partner
 * email, fee reversal, provenance runs).
 */
import fs from "fs"
import path from "path"
import { Modules } from "@medusajs/framework/utils"
import { assertNotWorkOrder } from "../helpers"

type Rows = { work_order?: any[]; orders?: any[] }

const containerWith = (rows: Rows, channel: { id: string } | null = { id: "sc_work" }) => {
  const graph = jest.fn(async ({ entity, filters }: any) => {
    if (entity === "work_order") return { data: rows.work_order ?? [] }
    if (entity === "orders") {
      const hit = (rows.orders ?? []).filter(
        (o) => o.id === filters.id && o.sales_channel_id === filters.sales_channel_id
      )
      return { data: hit }
    }
    return { data: [] }
  })
  const listSalesChannels = jest.fn(async () => (channel ? [channel] : []))
  const container: any = {
    resolve: (key: string) => (key === Modules.SALES_CHANNEL ? { listSalesChannels } : { graph }),
  }
  return { container, graph }
}

describe("assertNotWorkOrder", () => {
  it("refuses an id that has a work_order row", async () => {
    const { container } = containerWith({ work_order: [{ id: "order_wo" }] })
    await expect(assertNotWorkOrder("order_wo", container)).rejects.toThrow(/work order/i)
  })

  it("refuses a mirror in the work-orders channel even with no work_order row (failed shadow sync)", async () => {
    const { container } = containerWith({
      orders: [{ id: "order_mirror", sales_channel_id: "sc_work" }],
    })
    await expect(assertNotWorkOrder("order_mirror", container)).rejects.toThrow(/work order/i)
  })

  it("lets a retail order through", async () => {
    const { container } = containerWith({
      orders: [{ id: "order_retail", sales_channel_id: "sc_store" }],
    })
    await expect(assertNotWorkOrder("order_retail", container)).resolves.toBeUndefined()
  })

  it("lets a retail order through when the work-orders channel does not exist", async () => {
    const { container, graph } = containerWith({}, null)
    await expect(assertNotWorkOrder("order_retail", container)).resolves.toBeUndefined()
    expect(graph).toHaveBeenCalledTimes(1)
  })
})

/**
 * Every MUTATING partner order route that checks ownership must also refuse
 * work orders, so a route added later cannot quietly skip the guard.
 */
describe("partner order routes guard work orders", () => {
  const ordersDir = path.resolve(__dirname, "../orders")

  // POST /partners/orders/:id writes metadata only and keeps the unification
  // keys protected; it is used on work orders. Moved to our workflows in S3.
  const EXEMPT = new Set(["[id]/route.ts"])

  const routeFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === "__tests__" ? [] : routeFiles(p)
      return e.name === "route.ts" ? [p] : []
    })

  const mutating = routeFiles(ordersDir)
    .map((f) => ({ rel: path.relative(ordersDir, f), src: fs.readFileSync(f, "utf8") }))
    .filter(
      ({ rel, src }) =>
        !EXEMPT.has(rel) &&
        /export (const|async function) (POST|PUT|PATCH|DELETE)\b/.test(src) &&
        /validatePartnerOrderOwnership\(/.test(src)
    )

  it("finds the routes (a check that scans nothing passes vacuously)", () => {
    expect(mutating.length).toBeGreaterThanOrEqual(13)
  })

  it.each(mutating.map((r) => [r.rel, r.src] as const))("%s calls assertNotWorkOrder", (_rel, src) => {
    expect(src).toMatch(/await assertNotWorkOrder\(/)
  })
})
