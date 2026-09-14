import { pickPartnerLocation } from "../partner-run-steps"

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

})
