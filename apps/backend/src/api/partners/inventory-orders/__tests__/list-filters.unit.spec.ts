import { applyInventoryOrderListFilters } from "../list-filters"

const make = (over: Partial<{ id: string; status: string; stock_location: string }> = {}) => ({
  id: over.id ?? "invord_1",
  status: over.status ?? "Pending",
  stock_location: over.stock_location ?? "Warehouse A",
  quantity: 1,
})

describe("applyInventoryOrderListFilters (#484 partner inventory-orders search)", () => {
  const orders = [
    make({ id: "invord_alpha", status: "Pending", stock_location: "Warehouse A" }),
    make({ id: "invord_beta", status: "Shipped", stock_location: "Mumbai Depot" }),
    make({ id: "invord_gamma", status: "Pending", stock_location: "Mumbai Depot" }),
  ]

  it("returns all orders when no q/status given", () => {
    const { items, count } = applyInventoryOrderListFilters(orders, {})
    expect(count).toBe(3)
    expect(items).toHaveLength(3)
  })

  it("filters by free-text q on id (case-insensitive)", () => {
    const { items, count } = applyInventoryOrderListFilters(orders, { q: "BETA" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("invord_beta")
  })

  it("filters by q on stock location name", () => {
    const { items, count } = applyInventoryOrderListFilters(orders, { q: "mumbai" })
    expect(count).toBe(2)
    expect(items.map((o) => o.id)).toEqual(["invord_beta", "invord_gamma"])
  })

  it("filters by q on status text", () => {
    const { items, count } = applyInventoryOrderListFilters(orders, { q: "shipped" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("invord_beta")
  })

  it("non-matching q yields an empty set (the bug: used to return everything)", () => {
    const { items, count } = applyInventoryOrderListFilters(orders, { q: "no-such-thing" })
    expect(count).toBe(0)
    expect(items).toHaveLength(0)
  })

  it("status filter is exact and combines with q", () => {
    const { items, count } = applyInventoryOrderListFilters(orders, {
      status: "Pending",
      q: "mumbai",
    })
    expect(count).toBe(1)
    expect(items[0].id).toBe("invord_gamma")
  })

  it("counts the FULL matched set, paginating AFTER the filter (page-vs-set fix)", () => {
    // q matches 2; first page of size 1 returns 1 item but count stays 2.
    const { items, count } = applyInventoryOrderListFilters(orders, {
      q: "mumbai",
      offset: 0,
      limit: 1,
    })
    expect(count).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("invord_beta")

    const page2 = applyInventoryOrderListFilters(orders, { q: "mumbai", offset: 1, limit: 1 })
    expect(page2.count).toBe(2)
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0].id).toBe("invord_gamma")
  })

  it("trims/ignores whitespace-only q", () => {
    const { count } = applyInventoryOrderListFilters(orders, { q: "   " })
    expect(count).toBe(3)
  })
})
