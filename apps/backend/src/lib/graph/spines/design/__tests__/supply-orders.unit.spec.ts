import { designSpine } from "../index"

/*
 * The "Material on order" node (#2111).
 *
 * 🔴 THE LINK TABLES CANNOT BE KEYED BY NAME HERE. `defineLink().entryPoint` is
 * EMPTY under jest — the framework derives it at boot and nothing boots in a
 * unit test — so every link entry point collapses to the same empty string.
 * The stub therefore dispatches on the FIELDS each call asks for, which are
 * stable and are what the resolver actually writes. Same reasoning, and the
 * same caveat, as the production-run resolve spec: these tests cannot prove the
 * link NAME is right, only an integration test can.
 */

const DESIGN_ID = "design_1"
const ORDER_ID = "inv_order_1"

type Rows = Record<string, any[]>

const stubQuery = (rows: Rows) => ({
  graph: jest.fn(async ({ entity, fields }: any) => {
    if (!entity) {
      const f: string[] = fields ?? []
      // The design ↔ inventory_order link is the only read asking for this.
      if (f.includes("inventory_orders_id")) {
        return { data: rows.supply_links ?? [] }
      }
      return { data: [] }
    }
    return { data: rows[entity] ?? [] }
  }),
})

const resolve = (rows: Rows) =>
  designSpine.resolve({
    scope: { resolve: () => stubQuery(rows) },
    id: DESIGN_ID,
  } as any)

const node = (graph: any, key: string) =>
  graph.nodes.find((n: any) => n.key === key)
const edge = (graph: any, key: string) =>
  graph.edges.find((e: any) => e.to === key)

const baseDesign = {
  id: DESIGN_ID,
  name: "Oshen — Tea Towels",
  status: "Conceptual",
  design_type: "Original",
  partners: [],
  tasks: [],
  inventory_items: [],
  customers: [],
  specifications: [],
  colors: [],
  size_sets: [],
  components: [],
  used_in: [],
  media_files: null,
  moodboard: null,
}

describe("design spine — material on order (#2111)", () => {
  it("draws nothing when no order is attached", async () => {
    const graph = await resolve({ designs: [baseDesign] })
    expect(node(graph, "supply_orders")).toBeUndefined()
  })

  it("marks the design blocked while the cloth is not Delivered, and names Delivered", async () => {
    const graph = await resolve({
      designs: [baseDesign],
      supply_links: [
        { inventory_orders_id: ORDER_ID, notify_customer: true, notified_at: null, note: null },
      ],
      inventory_orders: [{ id: ORDER_ID, status: "Processing", quantity: 70.6 }],
    })

    const n = node(graph, "supply_orders")
    expect(n).toBeDefined()
    expect(n.type).toBe("inventory_order")
    expect(n.status).toBe("blocked")
    expect(n.count).toBe(1)
    expect(n.sublabel).toBe("1 of 1 not delivered")

    /*
     * 🔴 `Shipped` must not read as arrival. A reader who believes it will
     * chase a maker who does not have the cloth.
     */
    const e = edge(graph, "supply_orders")
    expect(e.reason).toContain("Delivered, not Shipped")
    expect(e.reason).toContain(ORDER_ID)
  })

  it("treats Shipped as NOT arrived", async () => {
    const graph = await resolve({
      designs: [baseDesign],
      supply_links: [{ inventory_orders_id: ORDER_ID, notify_customer: true }],
      inventory_orders: [{ id: ORDER_ID, status: "Shipped" }],
    })
    expect(node(graph, "supply_orders").status).toBe("blocked")
  })

  it("is met once the order is Delivered", async () => {
    const graph = await resolve({
      designs: [baseDesign],
      supply_links: [{ inventory_orders_id: ORDER_ID, notify_customer: true }],
      inventory_orders: [{ id: ORDER_ID, status: "Delivered" }],
    })
    const n = node(graph, "supply_orders")
    expect(n.status).toBe("met")
    expect(n.state).toBe("present")
    expect(edge(graph, "supply_orders").reason).toBeNull()
  })

  it("says so when no attached order will tell the client", async () => {
    const graph = await resolve({
      designs: [baseDesign],
      supply_links: [
        { inventory_orders_id: ORDER_ID, notify_customer: false, notified_at: null },
      ],
      inventory_orders: [{ id: ORDER_ID, status: "Processing" }],
    })
    /*
     * A deliberate silence that nothing displays is indistinguishable from the
     * bug this pipeline exists to end — a client told nothing because nobody
     * noticed. This is the four suppressed Oshen component designs.
     */
    expect(edge(graph, "supply_orders").reason).toContain(
      "No attached order will tell this design's client"
    )
  })

  it("stays quiet about notification when one attached order WILL tell the client", async () => {
    const graph = await resolve({
      designs: [baseDesign],
      supply_links: [
        { inventory_orders_id: ORDER_ID, notify_customer: true, notified_at: null },
      ],
      inventory_orders: [{ id: ORDER_ID, status: "Processing" }],
    })
    expect(edge(graph, "supply_orders").reason).not.toContain(
      "No attached order will tell"
    )
  })

  it("counts ORDERS THAT EXIST, not link rows", async () => {
    /*
     * 🔴 A LINK ROW IS NOT A RECORD. The partner spine once said "4 linked"
     * against four person ids that no longer existed. Two links here, one real
     * order.
     */
    const graph = await resolve({
      designs: [baseDesign],
      supply_links: [
        { inventory_orders_id: ORDER_ID, notify_customer: true },
        { inventory_orders_id: "inv_order_gone", notify_customer: true },
      ],
      inventory_orders: [{ id: ORDER_ID, status: "Delivered" }],
    })
    expect(node(graph, "supply_orders").count).toBe(1)
  })
})
