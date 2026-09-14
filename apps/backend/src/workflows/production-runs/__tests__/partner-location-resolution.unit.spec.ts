// Imported via partner-run-steps on purpose: it re-exports these, and a broken
// re-export would silently orphan every existing caller.
import { pickPartnerLocation } from "../partner-run-steps"
import { resolvePartnerLocation } from "../lib/partner-location"

/**
 * #2053 — where a partner's finished goods get banked.
 *
 * The resolver used to walk `partner → stores[0] → default_sales_channel_id →
 * sales_channels → stock_locations[0]`, with every hop failing to `undefined`
 * silently. Prod on 2026-09-14: **17 of 30 partners have no store**, so their
 * output was never banked and nothing said so.
 */
describe("partner stock location resolution (#2053)", () => {
  describe("pickPartnerLocation", () => {
    it("returns the single linked location", () => {
      expect(pickPartnerLocation([{ id: "sloc_1" }])).toEqual({ id: "sloc_1" })
    })

    it("returns null when there is none", () => {
      expect(pickPartnerLocation([])).toBeNull()
      expect(pickPartnerLocation(null)).toBeNull()
      expect(pickPartnerLocation(undefined)).toBeNull()
      expect(pickPartnerLocation([null])).toBeNull()
      expect(pickPartnerLocation([{ id: null }])).toBeNull()
    })

    /**
     * The whole point. `[0]` here banks physical goods in whichever city the
     * database returned first — the `stores[0]` shape (#2051, #1983) applied to
     * stock, where being wrong means the garments are not where the record says.
     */
    it("REFUSES to guess between two locations", () => {
      expect(pickPartnerLocation([{ id: "sloc_1" }, { id: "sloc_2" }])).toBeNull()
      expect(
        pickPartnerLocation([{ id: "sloc_1" }, { id: "sloc_2" }, { id: "sloc_3" }])
      ).toBeNull()
    })

    // The same row returned twice is one warehouse, not an ambiguity.
    it("treats duplicates of one location as unambiguous", () => {
      expect(pickPartnerLocation([{ id: "sloc_1" }, { id: "sloc_1" }])).toEqual({
        id: "sloc_1",
      })
    })

    it("ignores null entries around a single real one", () => {
      expect(pickPartnerLocation([null, { id: "sloc_1" }, { id: null }])).toEqual({
        id: "sloc_1",
      })
    })
  })


  /**
   * The async resolver is shared by BOTH the completion path
   * (`stockFinishedGoodsStep`) and the goods-transfer origin
   * (`resolveRunGoodsLocation`). It used to be two independent copies of the
   * same four-hop walk; these lock down the single implementation.
   */
  describe("resolvePartnerLocation", () => {
    const makeContainer = (graph: (args: any) => any) => ({
      resolve: (key: string) =>
        String(key).toLowerCase().includes("logger")
          ? { error: () => {}, warn: () => {}, info: () => {} }
          : { graph: async (args: any) => graph(args) },
    })

    const LINKED = (locs: any[]) => (args: any) => {
      if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
        return { data: [{ stock_locations: locs }] }
      }
      if (args.entity === "partners") return { data: [{ stores: [] }] }
      return { data: [] }
    }

    it("prefers the typed link over the legacy store chain", async () => {
      const container = makeContainer((args) => {
        if (args.fields?.includes("stock_locations.id") && args.entity === "partners") {
          return { data: [{ stock_locations: [{ id: "sloc_link" }] }] }
        }
        if (args.entity === "partners") {
          return { data: [{ stores: [{ default_sales_channel_id: "sc_1" }] }] }
        }
        return { data: [{ stock_locations: [{ id: "sloc_chain" }] }] }
      })
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        location_id: "sloc_link",
        source: "link",
      })
    })

    it("falls back to the store chain when nothing is linked", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
          return { data: [{ stock_locations: [] }] }
        }
        if (args.entity === "partners") {
          return { data: [{ stores: [{ default_sales_channel_id: "sc_1" }] }] }
        }
        return { data: [{ stock_locations: [{ id: "sloc_chain" }] }] }
      })
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        location_id: "sloc_chain",
        source: "store_chain",
      })
    })

    it("names the hop that broke — no store", async () => {
      const container = makeContainer(LINKED([]))
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        reason: "no_link_and_no_store",
      })
    })

    it("names the hop that broke — store with no sales channel", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
          return { data: [{ stock_locations: [] }] }
        }
        if (args.entity === "partners") {
          return { data: [{ stores: [{ default_sales_channel_id: null }] }] }
        }
        return { data: [] }
      })
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        reason: "store_has_no_sales_channel",
      })
    })

    it("names the hop that broke — channel reaches no single location", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
          return { data: [{ stock_locations: [] }] }
        }
        if (args.entity === "partners") {
          return { data: [{ stores: [{ default_sales_channel_id: "sc_1" }] }] }
        }
        return { data: [{ stock_locations: [] }] }
      })
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        reason: "sales_channel_has_no_location",
      })
    })

    it("refuses, with the candidates, when two locations are linked", async () => {
      const container = makeContainer(LINKED([{ id: "sloc_a" }, { id: "sloc_b" }]))
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        reason: "ambiguous_linked_locations",
        candidate_location_ids: ["sloc_a", "sloc_b"],
      })
    })

    it("answers no_partner without touching the database", async () => {
      let called = false
      const container = makeContainer(() => {
        called = true
        return { data: [] }
      })
      await expect(resolvePartnerLocation(container, null)).resolves.toEqual({
        reason: "no_partner",
      })
      expect(called).toBe(false)
    })

    /**
     * An environment where the link table has not been migrated yet must fall
     * through to the legacy chain, not fail the caller outright.
     */
    it("survives the link query throwing and still uses the chain", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "partners" && args.fields?.includes("stock_locations.id")) {
          throw new Error("relation does not exist")
        }
        if (args.entity === "partners") {
          return { data: [{ stores: [{ default_sales_channel_id: "sc_1" }] }] }
        }
        return { data: [{ stock_locations: [{ id: "sloc_chain" }] }] }
      })
      await expect(resolvePartnerLocation(container, "p_1")).resolves.toEqual({
        location_id: "sloc_chain",
        source: "store_chain",
      })
    })
  })
})
