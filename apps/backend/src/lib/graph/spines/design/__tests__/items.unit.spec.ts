import designConsumptionLogLink from "../../../../../links/design-consumption-log"
import designOrderLink from "../../../../../links/design-order-link"
import { resolveDesignItems, DESIGN_ITEM_NODES } from "../items"

/*
 * 🔴 The link tables are keyed by the LINK's own `entryPoint`, never by a
 * hand-written string. Medusa ABBREVIATES a link table name once it grows
 * long, so `design_consumption_log` is a guess about a name the framework
 * derives — and a stub keyed on the wrong one answers `[]` to a resolver that
 * is working perfectly, which reads exactly like "nothing is linked".
 */
const CONSUMPTION_ENTRY = designConsumptionLogLink.entryPoint
const ORDER_ENTRY = designOrderLink.entryPoint

/**
 * The member rows, and — the part worth testing — the REMOVE descriptor each
 * one carries.
 *
 * Every removal here points at an existing admin endpoint, and the four take
 * four different shapes. Getting one wrong produces a well-formed request to
 * the wrong record: it does not throw, it does not render red, and the row
 * disappears from the drawer either way. So the shapes are asserted rather
 * than eyeballed.
 */

/** A `query.graph` stub keyed by the entity each call asks for. */
const stubQuery = (byEntity: Record<string, any[]>) => ({
  graph: jest.fn(async ({ entity }: { entity: string }) => ({
    data: byEntity[entity] ?? [],
  })),
})

const ctx = (query: any) => ({
  scope: { resolve: () => query },
  id: "design_1",
})

describe("the node registry", () => {
  it("advertises exactly the nodes it can resolve", async () => {
    // The graph payload's `itemNodes` is this list; a node named here that
    // resolves to nothing would render "Nothing linked yet" forever.
    expect(DESIGN_ITEM_NODES).toEqual(
      expect.arrayContaining([
        "inventory",
        "components",
        "tasks",
        "partners",
        "runs",
        "consumption",
        "materials",
      ])
    )
  })

  it("answers an unknown node with an empty list, not an error", async () => {
    const query = stubQuery({})
    await expect(resolveDesignItems(ctx(query), "not_a_node")).resolves.toEqual([])
    // 🔴 And it must not query at all — `product` and `revision` land here on
    // every drawer open.
    expect(query.graph).not.toHaveBeenCalled()
  })
})

describe("inventory", () => {
  it("delinks exactly the one row, never the batch", async () => {
    const query = stubQuery({
      designs: [
        {
          id: "design_1",
          inventory_items: [
            { id: "inv_1", title: "Cotton", sku: "CTN-1" },
            { id: "inv_2", title: "Silk", sku: "SLK-1" },
          ],
        },
      ],
    })

    const items = await resolveDesignItems(ctx(query), "inventory")

    expect(items).toHaveLength(2)
    expect(items[0].remove).toMatchObject({
      method: "POST",
      path: "/admin/designs/design_1/inventory/delink",
      body: { inventoryIds: ["inv_1"] },
    })
    // The endpoint takes a LIST. One row means one id — never both.
    expect((items[0].remove!.body as any).inventoryIds).toEqual(["inv_1"])
    expect((items[1].remove!.body as any).inventoryIds).toEqual(["inv_2"])
  })
})

describe("bundled designs", () => {
  const bundleQuery = () =>
    stubQuery({
      designs: [
        {
          id: "design_1",
          components: [
            {
              id: "dc_in",
              quantity: 2,
              role: "lining",
              component_design: { id: "design_2", name: "Lining panel" },
            },
          ],
          used_in: [
            {
              id: "dc_out",
              quantity: 1,
              parent_design: { id: "design_3", name: "Jacket" },
            },
          ],
        },
      ],
    })

  it("lists both directions", async () => {
    const items = await resolveDesignItems(ctx(bundleQuery()), "components")
    expect(items.map((i) => i.label)).toEqual(["Lining panel", "Jacket"])
  })

  it("offers removal on the inbound row only", async () => {
    const items = await resolveDesignItems(ctx(bundleQuery()), "components")

    expect(items[0].remove).toMatchObject({
      method: "DELETE",
      path: "/admin/designs/design_1/components/dc_in",
    })
    /*
     * 🔴 The endpoint scopes its lookup by `parent_design_id`, so deleting a
     * `used_in` row from this side 404s. A button that always fails is worse
     * than no button.
     */
    expect(items[1].remove).toBeNull()
  })
})

describe("partners", () => {
  const partnerQuery = (runs: any[]) =>
    stubQuery({
      designs: [{ id: "design_1", partners: [{ id: "pt_1", name: "Weavers Co" }] }],
      production_runs: runs,
    })

  it("says how many live runs the cancellation takes with it", async () => {
    const items = await resolveDesignItems(
      ctx(
        partnerQuery([
          { id: "pr_1", partner_id: "pt_1", status: "in_progress" },
          { id: "pr_2", partner_id: "pt_1", status: "completed" },
          { id: "pr_3", partner_id: "pt_1", status: "cancelled" },
          { id: "pr_4", partner_id: "pt_other", status: "in_progress" },
        ])
      ),
      "partners"
    )

    // Only pr_1 is live AND theirs: completed and cancelled are done, pr_4 is
    // another partner's.
    expect(items[0].remove!.confirm).toContain("1 live run")
    expect(items[0].remove!.body).toEqual({ partner_id: "pt_1", unlink: true })
  })

  it("does not threaten cancellation when nothing is live", async () => {
    const items = await resolveDesignItems(
      ctx(partnerQuery([{ id: "pr_1", partner_id: "pt_1", status: "completed" }])),
      "partners"
    )
    expect(items[0].remove!.confirm).not.toContain("cancelled")
  })
})

describe("production runs", () => {
  it("never offers removal — a run is cancelled, not detached", async () => {
    const query = stubQuery({
      production_runs: [
        { id: "pr_1", name: "Run 1", status: "completed", approved_product_id: null },
      ],
    })
    const items = await resolveDesignItems(ctx(query), "runs")
    expect(items[0].remove).toBeNull()
  })

  it("names the run that is missing its product", async () => {
    const query = stubQuery({
      production_runs: [
        { id: "pr_1", status: "completed", approved_product_id: null },
        { id: "pr_2", status: "completed", approved_product_id: "prod_9" },
      ],
    })
    const items = await resolveDesignItems(ctx(query), "runs")
    const value = (i: any) =>
      i.props.find((p: any) => p.key === "approved_product_id")!.value
    // The whole motivating absence, per run rather than in aggregate.
    expect(value(items[0])).toBe("null")
    expect(value(items[1])).toBe("prod_9")
  })
})

describe("consumption logs", () => {
  const logQuery = (log: any) =>
    stubQuery({
      [CONSUMPTION_ENTRY]: [{ consumption_log_id: log.id }],
      consumption_logs: [log],
    })

  it("offers deletion while no stock has moved", async () => {
    const items = await resolveDesignItems(
      ctx(logQuery({ id: "cl_1", quantity: 5, unit_of_measure: "m" })),
      "consumption"
    )
    expect(items[0].remove).toMatchObject({
      method: "DELETE",
      path: "/admin/designs/design_1/consumption-logs/cl_1",
    })
  })

  it("withholds it once the stock movement is applied", async () => {
    /*
     * 🔴 The endpoint refuses this with "correct it with a reversing entry,
     * not an edit". Rendering the button anyway would put a 400 behind a
     * confirm dialog.
     */
    const items = await resolveDesignItems(
      ctx(
        logQuery({
          id: "cl_1",
          quantity: 5,
          inventory_applied_at: "2026-09-01T00:00:00Z",
        })
      ),
      "consumption"
    )
    expect(items[0].remove).toBeNull()
    expect(items[0].status).toBe("applied")
  })

  it("reads the applied flag off metadata too", async () => {
    // The field is written to both homes depending on the code path that
    // applied it; the endpoint checks both, so this must as well.
    const items = await resolveDesignItems(
      ctx(
        logQuery({
          id: "cl_1",
          quantity: 5,
          metadata: { inventory_applied_at: "2026-09-01T00:00:00Z" },
        })
      ),
      "consumption"
    )
    expect(items[0].remove).toBeNull()
  })

  it("asks for nothing when no log is linked", async () => {
    const query = stubQuery({ [CONSUMPTION_ENTRY]: [] })
    await expect(resolveDesignItems(ctx(query), "consumption")).resolves.toEqual([])
    // One call — it must not go on to fetch logs by an empty id list, which
    // reads as "no filter" and returns EVERY log in the system.
    expect(query.graph).toHaveBeenCalledTimes(1)
  })
})

describe("orders", () => {
  it("never offers removal — a sale is history", async () => {
    const query = stubQuery({
      [ORDER_ENTRY]: [{ order_id: "order_1" }],
      order: [{ id: "order_1", display_id: 42, status: "completed" }],
    })
    const items = await resolveDesignItems(ctx(query), "orders")
    expect(items[0].label).toBe("#42")
    expect(items[0].remove).toBeNull()
  })
})

describe("the row's two text slots", () => {
  /*
   * 🔴 A row prints `sublabel` under the title and `status` as a badge beside
   * it. Setting both to the same value is the natural thing to write and it
   * renders as the word "pending" twice, side by side — while every field is
   * populated, correct and passing. Only looking at the screen found it, so
   * the rule is pinned here.
   */
  it("never repeats the status as the sublabel", async () => {
    const query = stubQuery({
      designs: [
        {
          id: "design_1",
          tasks: [{ id: "t1", title: "Cut", status: "pending", priority: "high" }],
        },
      ],
      production_runs: [
        { id: "pr_1", status: "sent_to_partner", execution_mode: "outsourced" },
      ],
    })

    for (const node of ["tasks", "runs"]) {
      const items = await resolveDesignItems(ctx(query), node)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.status).toBeTruthy()
        expect(item.sublabel).not.toBe(item.status)
      }
    }
  })

  it("still says something useful in the sublabel", async () => {
    // Not merely "different from status" — an empty sublabel would also pass
    // the rule above while leaving the row with nothing to tell it apart.
    const query = stubQuery({
      production_runs: [
        {
          id: "pr_1",
          status: "completed",
          quantity_produced: 40,
          quantity_target: 50,
          approved_product_id: null,
        },
      ],
    })
    const [run] = await resolveDesignItems(ctx(query), "runs")
    expect(run.sublabel).toContain("40 produced")
    expect(run.sublabel).toContain("no product")
  })
})
