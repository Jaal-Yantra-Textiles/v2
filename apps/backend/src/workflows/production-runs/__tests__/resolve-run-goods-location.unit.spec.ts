import { resolveRunGoodsLocation } from "../create-production-run-transfer"

/**
 * `resolveRunGoodsLocation` decides where a goods transfer collects FROM.
 *
 * It had no tests at all. That was found by mutation: replacing its whole
 * partner fallback with `return undefined` left every existing suite green, so
 * nothing in the repo was checking the origin of a physical shipment. A wrong
 * answer here books a carrier pickup at a warehouse the goods are not in.
 *
 * It used to carry its own copy of the `partner → stores[0] → channel →
 * stock_locations[0]` walk; it now shares `resolvePartnerLocation`. #2053
 */
describe("resolveRunGoodsLocation (#2053)", () => {
  const makeContainer = (opts: {
    priorTransfers?: any[]
    priorThrows?: boolean
    graph?: (args: any) => any
  }) => ({
    resolve: (key: string) => {
      const k = String(key).toLowerCase()
      if (k.includes("logger")) return { error: () => {}, warn: () => {}, info: () => {} }
      if (k.includes("fullfilled") || k.includes("fulfilled")) {
        return {
          listGoodsTransfers: async () => {
            if (opts.priorThrows) throw new Error("no such table")
            return opts.priorTransfers ?? []
          },
        }
      }
      return { graph: async (args: any) => (opts.graph ? opts.graph(args) : { data: [] }) }
    },
  })

  /** A partner whose warehouse is stated by the typed link. */
  const linkedTo = (locId: string) => (args: any) => {
    if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
      return { data: [{ stock_locations: [{ id: locId }] }] }
    }
    return { data: [] }
  }

  it("uses the partner's linked warehouse when the goods have never moved", async () => {
    const container = makeContainer({ graph: linkedTo("sloc_partner") })
    await expect(
      resolveRunGoodsLocation(container as any, { id: "run_1", partner_id: "p_1" })
    ).resolves.toBe("sloc_partner")
  })

  /**
   * A delivered hop is the most recent truth about where the goods physically
   * are, and must beat the partner default — otherwise a second transfer
   * collects from the place the goods already left.
   */
  it("a delivered prior transfer wins over the partner default", async () => {
    const container = makeContainer({
      priorTransfers: [{ to_location_id: "sloc_landed" }],
      graph: linkedTo("sloc_partner"),
    })
    await expect(
      resolveRunGoodsLocation(container as any, { id: "run_1", partner_id: "p_1" })
    ).resolves.toBe("sloc_landed")
  })

  it("falls back to the partner when the transfer lookup throws", async () => {
    const container = makeContainer({ priorThrows: true, graph: linkedTo("sloc_partner") })
    await expect(
      resolveRunGoodsLocation(container as any, { id: "run_1", partner_id: "p_1" })
    ).resolves.toBe("sloc_partner")
  })

  it("returns undefined when the run has no partner and no prior hop", async () => {
    const container = makeContainer({})
    await expect(
      resolveRunGoodsLocation(container as any, { id: "run_1", partner_id: null })
    ).resolves.toBeUndefined()
  })

  /**
   * The 17-of-30 case: no link and no store. Undefined is the honest answer —
   * the CALLER must refuse rather than book a pickup at nowhere.
   */
  it("returns undefined when the partner has no warehouse at all", async () => {
    const container = makeContainer({
      graph: (args: any) => {
        if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
          return { data: [{ stock_locations: [] }] }
        }
        if (args.entity === "partners") return { data: [{ stores: [] }] }
        return { data: [] }
      },
    })
    await expect(
      resolveRunGoodsLocation(container as any, { id: "run_1", partner_id: "p_1" })
    ).resolves.toBeUndefined()
  })

  it("refuses rather than guessing when the partner has two linked warehouses", async () => {
    const container = makeContainer({
      graph: (args: any) => {
        if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
          return { data: [{ stock_locations: [{ id: "sloc_a" }, { id: "sloc_b" }] }] }
        }
        return { data: [] }
      },
    })
    await expect(
      resolveRunGoodsLocation(container as any, { id: "run_1", partner_id: "p_1" })
    ).resolves.toBeUndefined()
  })
})
