import {
  applyReservationListFilters,
  PartnerReservationView,
} from "../list-filters"

const make = (over: Partial<PartnerReservationView> & { id: string }): PartnerReservationView => ({
  inventory_item_id: null,
  location_id: null,
  description: null,
  ...over,
})

const SET: PartnerReservationView[] = [
  make({ id: "res_1", inventory_item_id: "iitem_red", location_id: "sloc_a", description: "Red cotton spool" }),
  make({ id: "res_2", inventory_item_id: "iitem_blue", location_id: "sloc_b", description: "Blue silk thread" }),
  make({ id: "res_3", inventory_item_id: "iitem_green", location_id: "sloc_a", description: "Green wool batch" }),
]

describe("applyReservationListFilters", () => {
  it("returns the full set (paginated) when q is absent", () => {
    const { items, count } = applyReservationListFilters(SET, {})
    expect(count).toBe(3)
    expect(items).toHaveLength(3)
  })

  it("matches q on description (case-insensitive)", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "SILK" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("res_2")
  })

  it("matches q on inventory_item_id", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "iitem_green" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("res_3")
  })

  it("matches q on id", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "res_1" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("res_1")
  })

  it("matches q on location_id", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "sloc_a" })
    expect(count).toBe(2)
    expect(items.map((r) => r.id)).toEqual(["res_1", "res_3"])
  })

  it("returns empty for a non-matching q", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "nope" })
    expect(count).toBe(0)
    expect(items).toHaveLength(0)
  })

  it("counts the TOTAL matched before pagination (page-vs-set guard)", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "iitem", limit: 2, offset: 0 })
    // all three match "iitem" prefix; count is total, page is limited to 2
    expect(count).toBe(3)
    expect(items).toHaveLength(2)
    expect(items.map((r) => r.id)).toEqual(["res_1", "res_2"])
  })

  it("paginates with offset after filtering", () => {
    const { items, count } = applyReservationListFilters(SET, { q: "iitem", limit: 2, offset: 2 })
    expect(count).toBe(3)
    expect(items.map((r) => r.id)).toEqual(["res_3"])
  })

  it("trims whitespace-only q to a no-op match-all", () => {
    const { count } = applyReservationListFilters(SET, { q: "   " })
    expect(count).toBe(3)
  })
}
)
