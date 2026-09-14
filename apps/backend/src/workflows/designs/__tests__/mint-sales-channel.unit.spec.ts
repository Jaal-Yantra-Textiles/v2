import {
  pickPartnerStore,
  resolveMintSalesChannel,
} from "../lib/mint-sales-channel"

/**
 * #2059 — which catalogue a design's minted product lands in.
 *
 * The fallback was `listStores({})[0].default_sales_channel_id`. On a 14-store
 * platform that is whichever row Postgres returned first — always the core
 * store — so a partner's design was minted into a catalogue belonging to nobody
 * selling it. Same family as the currency lottery (#2051) and the warehouse
 * walk (#2053).
 */
describe("mint sales channel resolution (#2059)", () => {
  describe("pickPartnerStore", () => {
    it("returns the single store", () => {
      expect(pickPartnerStore([{ id: "store_1" }])).toEqual({ id: "store_1" })
    })

    it("returns null for none", () => {
      expect(pickPartnerStore([])).toBeNull()
      expect(pickPartnerStore(null)).toBeNull()
      expect(pickPartnerStore([{ id: null }])).toBeNull()
    })

    it("REFUSES to guess between two stores", () => {
      expect(pickPartnerStore([{ id: "store_1" }, { id: "store_2" }])).toBeNull()
    })
  })

  describe("resolveMintSalesChannel", () => {
    /**
     * The prod shape: the house store first in row order (so a regression to
     * `stores[0]` picks it) and partner stores after.
     */
    const HOUSE = { id: "store_house", metadata: {}, supported_currencies: [] }
    const PARTNER_STORE = {
      id: "store_partner",
      metadata: { partner_id: "p_1" },
      supported_currencies: [],
    }

    const makeContainer = (opts: {
      partnerStores?: any[]
      stores?: any[]
      partners?: any[]
      houseChannel?: string | null
      graphThrows?: boolean
    }) => ({
      resolve: (key: string) => {
        const k = String(key).toLowerCase()
        if (k.includes("store") && !k.includes("query")) {
          return {
            retrieveStore: async (id: string) =>
              id === "store_house"
                ? {
                    id,
                    // `?? "sc_house"` here would swallow a deliberate null —
                    // the test for "house store names no channel" would then
                    // assert against a channel the mock invented.
                    default_sales_channel_id:
                      "houseChannel" in opts ? opts.houseChannel : "sc_house",
                  }
                : null,
          }
        }
        return {
          graph: async (args: any) => {
            if (opts.graphThrows) throw new Error("boom")
            if (args.entity === "partners" && args.filters?.id) {
              return { data: [{ id: args.filters.id, stores: opts.partnerStores ?? [] }] }
            }
            if (args.entity === "partners") {
              return { data: opts.partners ?? [{ id: "p_1", stores: [{ id: "store_partner" }] }] }
            }
            if (args.entity === "store") {
              return { data: opts.stores ?? [HOUSE, PARTNER_STORE] }
            }
            return { data: [] }
          },
        }
      },
    })

    it("the caller's explicit channel wins and costs no query", async () => {
      let queried = false
      const container = {
        resolve: () => ({
          graph: async () => {
            queried = true
            return { data: [] }
          },
        }),
      }
      await expect(
        resolveMintSalesChannel(container, { explicitSalesChannelId: "sc_caller" })
      ).resolves.toEqual({ sales_channel_id: "sc_caller", source: "explicit" })
      expect(queried).toBe(false)
    })

    it("a blank explicit channel is not an answer", async () => {
      const container = makeContainer({})
      const res = await resolveMintSalesChannel(container, {
        explicitSalesChannelId: "   ",
      })
      expect(res.source).toBe("house_store")
    })

    it("a partner-owned design goes to the PARTNER's catalogue, not the house", async () => {
      const container = makeContainer({
        partnerStores: [{ id: "store_partner", default_sales_channel_id: "sc_partner" }],
      })
      await expect(
        resolveMintSalesChannel(container, { ownerPartnerId: "p_1" })
      ).resolves.toEqual({ sales_channel_id: "sc_partner", source: "owner_partner" })
    })

    it("an unowned design goes to the house store", async () => {
      const container = makeContainer({})
      await expect(
        resolveMintSalesChannel(container, { ownerPartnerId: null })
      ).resolves.toEqual({ sales_channel_id: "sc_house", source: "house_store" })
    })

    it("refuses when the owning partner has two stores", async () => {
      const container = makeContainer({
        partnerStores: [
          { id: "store_a", default_sales_channel_id: "sc_a" },
          { id: "store_b", default_sales_channel_id: "sc_b" },
        ],
      })
      await expect(
        resolveMintSalesChannel(container, { ownerPartnerId: "p_1" })
      ).resolves.toEqual({ reason: "ambiguous_partner_stores" })
    })

    /**
     * Deliberately does NOT fall through to the house store. A partner-owned
     * design minted into the platform catalogue is the original bug wearing a
     * different hat — the product would be sellable by the wrong tenant.
     */
    it("refuses rather than falling back to the house when the partner has no store", async () => {
      const container = makeContainer({ partnerStores: [] })
      await expect(
        resolveMintSalesChannel(container, { ownerPartnerId: "p_1" })
      ).resolves.toEqual({ reason: "partner_has_no_store" })
    })

    it("refuses when the partner's store names no channel", async () => {
      const container = makeContainer({
        partnerStores: [{ id: "store_partner", default_sales_channel_id: null }],
      })
      await expect(
        resolveMintSalesChannel(container, { ownerPartnerId: "p_1" })
      ).resolves.toEqual({ reason: "partner_store_has_no_channel" })
    })

    /** Two house stores is not a house store — readHouseStore returns null. */
    it("refuses when the house store is ambiguous", async () => {
      const container = makeContainer({
        stores: [
          { id: "store_h1", metadata: {}, supported_currencies: [] },
          { id: "store_h2", metadata: {}, supported_currencies: [] },
        ],
        partners: [],
      })
      await expect(
        resolveMintSalesChannel(container, {})
      ).resolves.toEqual({ reason: "no_house_store" })
    })

    it("refuses when the house store names no channel", async () => {
      const container = makeContainer({ houseChannel: null })
      await expect(resolveMintSalesChannel(container, {})).resolves.toEqual({
        reason: "house_store_has_no_channel",
      })
    })
  })
})
