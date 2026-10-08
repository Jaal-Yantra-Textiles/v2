import { selectCountReminders } from "../count-reminders"

/**
 * #2289 S4 — remind a receiving partner 3 days after the carrier delivered
 * (founder decision 2026-10-08); our own warehouse is never reminded.
 */
describe("selectCountReminders", () => {
  const now = new Date("2026-10-20T09:30:00Z")
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
  const order = (over: Record<string, any> = {}) =>
    ({
      id: "inv_1",
      status: "Shipped",
      partner_id: "supplier",
      partner_name: "Supplier",
      destination_location_id: "loc_partner",
      destination_name: "Partner WH",
      first_dispatched_at: daysAgo(6),
      last_dispatched_at: daysAgo(6),
      days_since_dispatch: 6,
      carrier_delivered: false,
      carrier_delivered_at: null,
      awaiting_quantity: 10,
      lines: [],
      ...over,
    }) as any
  const partners = new Map([["loc_partner", "receiver"]])

  it("reminds the receiving partner 3 days after the carrier delivered", () => {
    const due = selectCountReminders(
      [order({ carrier_delivered: true, carrier_delivered_at: daysAgo(3.2) })],
      partners, new Set(), now
    )
    expect(due).toEqual([
      { order_id: "inv_1", partner_id: "receiver", awaiting_quantity: 10, days_waiting: 3, basis: "carrier_delivered" },
    ])
  })

  it("waits until 3 days have passed since delivery, however old the dispatch", () => {
    const due = selectCountReminders(
      [order({ carrier_delivered: true, carrier_delivered_at: daysAgo(2) })],
      partners, new Set(), now
    )
    expect(due).toEqual([])
  })

  it("with no carrier on the platform, counts from the dispatch", () => {
    const due = selectCountReminders([order()], partners, new Set(), now)
    expect(due[0]).toEqual(expect.objectContaining({ basis: "dispatched", days_waiting: 6 }))
  })

  it("never reminds for our own warehouse (no partner owns it)", () => {
    const due = selectCountReminders([order({ destination_location_id: "loc_ours" })], partners, new Set(), now)
    expect(due).toEqual([])
  })

  it("skips an order reminded within the cooldown", () => {
    const due = selectCountReminders([order()], partners, new Set(["inv_1"]), now)
    expect(due).toEqual([])
  })
})
