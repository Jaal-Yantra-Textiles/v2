import { productionRunSpine } from "../index"

/*
 * 🔴 THE LINK TABLES CANNOT BE KEYED BY NAME HERE. `defineLink().entryPoint` is
 * EMPTY under jest — the framework derives it at boot, and nothing boots in a
 * unit test — so all four of this spine's link entry points are the same empty
 * string. Keying a stub on them silently collapses tasks, materials,
 * consumption logs and the work-order into ONE bucket, where the last key
 * written wins and every other node reads as "nothing linked". That is exactly
 * the failure this graph exists to tell apart, and it cost a green-looking
 * stub before it was caught.
 *
 * So the stub dispatches on the FIELDS each call asks for, which are stable and
 * are what the resolver actually writes.
 *
 * ⚠️ The consequence is that these tests cannot prove the link NAMES are right.
 * Medusa abbreviates a long link table name, and a wrong one returns an empty
 * result rather than an error. Only an integration test can prove that edge,
 * and none of these claims to.
 */

const RUN_ID = "prod_run_1"

type Rows = Record<string, any[]>

/**
 * A `query.graph` stub. `production_runs` is asked three different questions
 * (this run, its children, its upstream runs), so the stub reads the FILTERS
 * rather than the entity alone — keying on entity only would hand the run's own
 * row back as its own child.
 */
const stubQuery = (rows: Rows) => ({
  graph: jest.fn(async ({ entity, filters, fields }: any) => {
    if (entity === "production_runs") {
      if (filters?.parent_run_id) return { data: rows.children ?? [] }
      if (filters?.id === RUN_ID || filters?.id?.[0] === RUN_ID) {
        return { data: rows.run ?? [] }
      }
      if (filters?.id) return { data: rows.upstream_runs ?? [] }
    }
    // A link read: identified by what it asks for, not by its empty entryPoint.
    if (!entity) {
      const f: string[] = fields ?? []
      if (f.includes("task_id")) return { data: rows.task_links ?? [] }
      if (f.includes("consumption_log_id")) return { data: rows.log_links ?? [] }
      if (f.includes("inventory_item_id")) return { data: rows.material_links ?? [] }
      if (f.includes("order_id")) return { data: rows.work_order_links ?? [] }
    }
    return { data: rows[entity] ?? [] }
  }),
})

const resolve = (rows: Rows) =>
  productionRunSpine.resolve({
    scope: { resolve: () => stubQuery(rows) },
    id: RUN_ID,
  })

const node = (graph: any, key: string) =>
  graph.nodes.find((n: any) => n.key === key)
const edge = (graph: any, key: string) =>
  graph.edges.find((e: any) => e.to === key)

const baseRun = {
  id: RUN_ID,
  status: "approved",
  run_type: "production",
  quantity: 2,
  design_id: null,
  partner_id: null,
  order_line_item_id: null,
  produced_quantity: null,
  approved_product_id: null,
  stocked_at_location_id: null,
  depends_on_inventory_order_ids: null,
  depends_on_run_ids: null,
}

describe("the production-run spine", () => {
  it("404s on a run that does not exist, rather than drawing an empty graph", async () => {
    // An empty graph is indistinguishable from "this run has no neighbours",
    // which is the confusion the whole view exists to remove.
    await expect(resolve({ run: [] })).rejects.toThrow(/was not found/)
  })

  describe("waiting on materials", () => {
    /*
     * 🔴 THE CASE THE WHOLE EPIC IS ABOUT, and it mirrors the S1 proof on prod
     * exactly: two attached orders, one Delivered and one Pending. The gate
     * named the Pending one and left the Delivered one out — which is what
     * makes the result mean anything. Attaching only an unmet order would have
     * been one experiment run twice.
     */
    const twoOrders = {
      run: [
        {
          ...baseRun,
          depends_on_inventory_order_ids: ["inv_order_unmet", "inv_order_met"],
        },
      ],
      inventory_orders: [
        { id: "inv_order_unmet", status: "Pending", quantity: 86 },
        { id: "inv_order_met", status: "Delivered", quantity: 2 },
      ],
    }

    it("names the undelivered order and leaves the delivered one out", async () => {
      const graph = await resolve(twoOrders)
      const reason = edge(graph, "depends_on_inventory_orders").reason

      expect(reason).toContain("inv_order_unmet is Pending")
      // THE CONTROL. A reason that listed both would prove the spine reads the
      // field, not that it understands it.
      expect(reason).not.toContain("inv_order_met")
    })

    it("holds the node as blocked while anything is undelivered", async () => {
      const graph = await resolve(twoOrders)
      const n = node(graph, "depends_on_inventory_orders")

      expect(n.status).toBe("blocked")
      expect(n.state).toBe("derived")
      expect(n.count).toBe(2)
      expect(n.sublabel).toBe("1 of 2 not delivered")
      expect(graph.summary.derived).toBeGreaterThan(0)
    })

    it("releases once every order is delivered", async () => {
      const graph = await resolve({
        run: [{ ...baseRun, depends_on_inventory_order_ids: ["inv_order_met"] }],
        inventory_orders: [{ id: "inv_order_met", status: "Delivered" }],
      })
      const n = node(graph, "depends_on_inventory_orders")

      expect(n.status).toBe("met")
      expect(n.state).toBe("present")
      expect(edge(graph, "depends_on_inventory_orders").reason).toBeNull()
    })
  })

  describe("who the run is for", () => {
    it("🔴 states the phantom-duplicate consequence when nothing commissioned it", async () => {
      const graph = await resolve({ run: [baseRun] })
      const e = edge(graph, "order_line")

      expect(node(graph, "order_line").state).toBe("absent")
      expect(e.label).toBe("order_line_item_id")
      // The sentence has to carry the COST, not just the absence: 124 of 146
      // runs are in this state and most of them are fine.
      expect(e.reason).toMatch(/duplicate/i)
    })

    it("draws the edge when an order line is attached", async () => {
      const graph = await resolve({
        run: [{ ...baseRun, order_line_item_id: "ordli_1", order_id: "order_1" }],
      })

      expect(node(graph, "order_line").state).toBe("present")
      expect(node(graph, "order_line").href).toBe("/orders/order_1")
    })
  })

  describe("what came out", () => {
    it("🔴 tells a reported zero apart from an unstated quantity", async () => {
      /*
       * A payout is measured against `produced_quantity`. "We checked and none
       * were usable" and "nobody ever said" must not render as the same node.
       */
      const reported = await resolve({
        run: [{ ...baseRun, status: "completed", produced_quantity: 0 }],
      })
      expect(node(reported, "output").state).toBe("present")
      expect(node(reported, "output").sublabel).toBe("0 of 2")

      const unstated = await resolve({
        run: [{ ...baseRun, status: "completed", produced_quantity: null }],
      })
      expect(node(unstated, "output").state).toBe("absent")
      expect(node(unstated, "output").sublabel).toBe("nobody said")
    })

    it("marks a short run without hiding it", async () => {
      const graph = await resolve({
        run: [{ ...baseRun, status: "completed", produced_quantity: 1, quantity: 2 }],
      })
      expect(node(graph, "output").status).toBe("short")
    })
  })

  describe("the pair", () => {
    it("🔴 does not claim nobody is assigned when a child carries the partner", async () => {
      /*
       * 54 of 146 runs are children, and on a pair the parent commonly has no
       * partner while the child does. Asserting on the parent would raise a
       * fault on half the live board for a shape that is correct.
       */
      const graph = await resolve({
        run: [{ ...baseRun, status: "in_progress" }],
        children: [{ id: "prod_run_2", status: "in_progress", partner_id: "pa_1" }],
      })

      expect(node(graph, "partner")).toBeUndefined()
      expect(node(graph, "child_runs").sublabel).toBe("1, 1 with a partner")
    })

    it("asks for a partner on a live run that has no children either", async () => {
      const graph = await resolve({ run: [{ ...baseRun, status: "in_progress" }] })

      expect(node(graph, "partner").state).toBe("absent")
      // `assign-partner` is inert — the reason has to name the tool that tells
      // the partner anything.
      expect(edge(graph, "partner").reason).toMatch(/send-to-partner/)
    })
  })

  it("does not count link rows as records", async () => {
    /*
     * 🔴 A LINK ROW IS NOT A RECORD. Three task links whose tasks are gone must
     * render as no tasks — the count and the drawer's rows come from different
     * places, and a graph that contradicts itself is worse than either number.
     */
    const graph = await resolve({
      run: [{ ...baseRun, status: "in_progress" }],
      task_links: [{ task_id: "task_gone_1" }, { task_id: "task_gone_2" }],
      task: [],
    })

    expect(node(graph, "tasks")).toBeUndefined()
  })

  it("counts the tasks that do exist", async () => {
    const graph = await resolve({
      run: [{ ...baseRun, status: "in_progress" }],
      task_links: [{ task_id: "task_1" }],
      task: [{ id: "task_1", title: "Sampling" }],
    })

    expect(node(graph, "tasks").count).toBe(1)
  })

  it("asserts nothing about material that was never allocated", async () => {
    // Most runs have no allocation at all; an absent node on every one of them
    // is how a graph starts crying wolf.
    const graph = await resolve({
      run: [{ ...baseRun, status: "completed", produced_quantity: 1 }],
      material_links: [],
      log_links: [],
    })

    expect(node(graph, "consumption")).toBeUndefined()
  })

  it("asks where the cloth went when material was allocated and never logged", async () => {
    const graph = await resolve({
      run: [{ ...baseRun, status: "completed", produced_quantity: 1 }],
      material_links: [{ inventory_item_id: "iitem_1" }],
      inventory_item: [{ id: "iitem_1" }],
      log_links: [],
    })

    expect(node(graph, "consumption").state).toBe("absent")
    expect(edge(graph, "consumption").reason).toMatch(/cost of the cloth/i)
  })

  it("draws the collating work-order", async () => {
    const graph = await resolve({
      run: [baseRun],
      work_order_links: [{ order_id: "order_wo_1" }],
    })

    expect(node(graph, "work_order").href).toBe("/orders/order_wo_1")
  })
})
