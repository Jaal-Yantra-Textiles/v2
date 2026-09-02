import {
  WORK_ORDER_COLLATION_WINDOW_DAYS,
  buildWorkOrderItems,
  findOpenPartnerWorkOrder,
} from "../dual-write-unified-run-order"
import PartnerOrderLink from "../../../links/partner-order"

/**
 * #1597 — a partner sent four designs across a week got four work-orders.
 * Collating into their open one is now the default, and these pin the two
 * halves that decide whether that default is safe: which order is chosen, and
 * that a joined line describes itself exactly like a created one.
 */

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

const order = (over: Record<string, any> = {}) => ({
  id: "order_1",
  status: "pending",
  created_at: daysAgo(2),
  metadata: { collated_design_order: true },
  production_runs: [{ id: "run_1" }],
  ...over,
})

const containerWith = (
  orders: any[],
  opts: { linkRows?: any[]; onGraph?: (a: any) => void } = {}
) => {
  const graph = jest.fn(async (args: any) => {
    opts.onGraph?.(args)
    if (args.entity === "order") return { data: orders }
    return {
      data:
        opts.linkRows ?? orders.map((o: any) => ({ order_id: o.id })),
    }
  })
  return {
    graph,
    container: {
      resolve: (key: string) => {
        if (key === "query") return { graph }
        if (key === "logger")
          return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
        throw new Error(`unexpected resolve(${key})`)
      },
    } as any,
  }
}

describe("findOpenPartnerWorkOrder", () => {
  it("returns the partner's open collated work-order", async () => {
    const { container } = containerWith([order()])

    const found = await findOpenPartnerWorkOrder(container, "partner_1")

    expect(found).toEqual({ order_id: "order_1", created_at: expect.any(String) })
  })

  it("picks the MOST RECENT when several are open", async () => {
    const { container } = containerWith([
      order({ id: "old", created_at: daysAgo(9) }),
      order({ id: "newest", created_at: daysAgo(1) }),
      order({ id: "middle", created_at: daysAgo(4) }),
    ])

    expect((await findOpenPartnerWorkOrder(container, "partner_1"))?.order_id).toBe(
      "newest"
    )
  })

  /**
   * 🔴 An open order from months ago is not the same batch of work. Appending
   * to it would put today's design on a claim someone may already be
   * reconciling.
   */
  it("ignores an order older than the collation window", async () => {
    const { container } = containerWith([
      order({ created_at: daysAgo(WORK_ORDER_COLLATION_WINDOW_DAYS + 1) }),
    ])

    expect(await findOpenPartnerWorkOrder(container, "partner_1")).toBeNull()
  })

  it("honours an explicit window", async () => {
    const { container } = containerWith([order({ created_at: daysAgo(5) })])

    expect(
      await findOpenPartnerWorkOrder(container, "partner_1", { withinDays: 3 })
    ).toBeNull()
    expect(
      await findOpenPartnerWorkOrder(container, "partner_1", { withinDays: 30 })
    ).not.toBeNull()
  })

  it.each(["completed", "canceled", "cancelled"])(
    "never joins a %s order",
    async (status) => {
      const { container } = containerWith([order({ status })])
      expect(await findOpenPartnerWorkOrder(container, "partner_1")).toBeNull()
    }
  )

  /**
   * A per-run work-order has no room for another design — only orders minted
   * BY the collation path can collect more.
   */
  it("skips an order that is not a collated one", async () => {
    const { container } = containerWith([order({ metadata: {} })])
    expect(await findOpenPartnerWorkOrder(container, "partner_1")).toBeNull()
  })

  /**
   * 🔴 The kind=design discriminator is the order↔run LINK, not metadata. An
   * order with no linked run is not a work-order at all.
   */
  it("skips an order with no linked production run", async () => {
    const { container } = containerWith([order({ production_runs: [] })])
    expect(await findOpenPartnerWorkOrder(container, "partner_1")).toBeNull()
  })

  it("tolerates the to-one link shape (object, not array)", async () => {
    const { container } = containerWith([
      order({ production_runs: { id: "run_1" } }),
    ])
    expect((await findOpenPartnerWorkOrder(container, "partner_1"))?.order_id).toBe(
      "order_1"
    )
  })

  it("returns null when the partner has no linked orders at all", async () => {
    const { container } = containerWith([], { linkRows: [] })
    expect(await findOpenPartnerWorkOrder(container, "partner_1")).toBeNull()
  })

  /**
   * 🔴 Read through the LINK's entry point. Asking the order entity for a
   * linked field returns no key, silently — every partner would look like they
   * had nothing open, and the default would quietly revert to minting.
   */
  it("reads the partner side through the link entry point, filtered by partner", async () => {
    const seen: any[] = []
    const { container } = containerWith([order()], { onGraph: (a) => seen.push(a) })

    await findOpenPartnerWorkOrder(container, "partner_1")

    expect(seen[0].entity).toBe(PartnerOrderLink.entryPoint)
    expect(seen[0].filters).toEqual({ partner_id: "partner_1" })
    /**
     * ⚠️ `defineLink().entryPoint` is empty until the modules are registered,
     * so the line above would pass vacuously against `""` on its own. This is
     * the assertion that actually bites: the partner side must NOT be read off
     * the order entity, which is the shape that silently returns no key.
     */
    expect(seen[0].entity).not.toBe("order")
    expect(seen[0].fields).toEqual(["order_id"])
  })

  /**
   * ⚠️ Failing to FIND must fall back to creating, never block dispatch.
   */
  it("returns null rather than throwing when the lookup fails", async () => {
    const container = {
      resolve: (key: string) => {
        if (key === "query")
          return {
            graph: jest.fn(async () => {
              throw new Error("graph exploded")
            }),
          }
        return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
      },
    } as any

    await expect(
      findOpenPartnerWorkOrder(container, "partner_1")
    ).resolves.toBeNull()
  })

  it("returns null for a missing partner id without querying", async () => {
    const { container, graph } = containerWith([order()])
    expect(await findOpenPartnerWorkOrder(container, "")).toBeNull()
    expect(graph).not.toHaveBeenCalled()
  })
})

/**
 * The line builder is shared by the create and the join path — a line must not
 * describe itself differently depending on which door it came through.
 */
describe("buildWorkOrderItems", () => {
  it("prices a per_unit run at its estimate", () => {
    const [item] = buildWorkOrderItems([
      {
        id: "run_1",
        design_id: "design_1",
        quantity: 4,
        cost_type: "per_unit",
        partner_cost_estimate: 700,
        snapshot: { design: { name: "White Envelope Dress" } },
      },
    ])

    expect(item.title).toBe("White Envelope Dress")
    expect(item.quantity).toBe(4)
    expect(item.unit_price).toBe(700)
    expect(item.metadata).toMatchObject({
      design_id: "design_1",
      production_run_id: "run_1",
      cost_type: "per_unit",
    })
  })

  /**
   * 🔴 A `total` is the agreed price for the whole run, so the per-unit line
   * price is the total DIVIDED by quantity. Treating it as a rate would bill
   * quantity times too much (#1596).
   */
  it("divides a total estimate across the quantity", () => {
    const [item] = buildWorkOrderItems([
      {
        id: "run_2",
        design_id: "d2",
        quantity: 5,
        cost_type: "total",
        partner_cost_estimate: 10_000,
        snapshot: {},
      },
    ])

    expect(item.unit_price).toBe(2000)
    expect(item.metadata.legacy_cost_estimate).toBe(10_000)
  })

  it("falls back to the design id when the snapshot has no name", () => {
    const [item] = buildWorkOrderItems([
      { id: "r", design_id: "design_9", quantity: 1, snapshot: {} },
    ])
    expect(item.title).toBe("Design design_9")
  })

  it("never divides by zero", () => {
    const [item] = buildWorkOrderItems([
      {
        id: "r",
        design_id: "d",
        quantity: 0,
        cost_type: "total",
        partner_cost_estimate: 900,
        snapshot: {},
      },
    ])
    // quantity 0 coerces to 1, so the total is the unit price.
    expect(item.quantity).toBe(1)
    expect(item.unit_price).toBe(900)
  })
})
