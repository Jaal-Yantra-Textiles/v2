import {
  statusFromFulfillment,
  timelineFromFulfillment,
} from "../fulfillment-tracking"

/**
 * The local fallback, which is the half that misleads. When no carrier can be
 * called, these two functions ARE the tracking answer — and on order 83 they
 * would have said "Awaiting Shipping" for a parcel that had a Blue Dart waybill
 * printed days earlier. That is a true statement about our records and a
 * potentially false one about the parcel, which is why the route labels the
 * source rather than letting the two blur.
 */

// Order 83's real shape at the time of writing: label created, never shipped.
const ORDER_83 = {
  created_at: "2026-08-14T10:47:18.251Z",
  shipped_at: null,
  delivered_at: null,
  canceled_at: null,
}

describe("statusFromFulfillment", () => {
  it("reports Awaiting Shipping when nothing has been marked", () => {
    expect(statusFromFulfillment(ORDER_83)).toBe("Awaiting Shipping")
  })

  it("prefers Canceled over every other timestamp", () => {
    expect(
      statusFromFulfillment({
        shipped_at: "2026-08-08T13:10:05.725Z",
        delivered_at: "2026-08-12T00:00:00.000Z",
        canceled_at: "2026-08-14T07:04:21.440Z",
      })
    ).toBe("Canceled")
  })

  it("prefers Delivered over Shipped", () => {
    expect(
      statusFromFulfillment({
        shipped_at: "2026-08-08T13:10:05.725Z",
        delivered_at: "2026-08-12T00:00:00.000Z",
      })
    ).toBe("Delivered")
  })

  it("reports Shipped once shipped_at is set", () => {
    expect(
      statusFromFulfillment({ shipped_at: "2026-08-08T13:10:05.725Z" })
    ).toBe("Shipped")
  })
})

describe("timelineFromFulfillment", () => {
  it("emits only the timestamps that exist", () => {
    const events = timelineFromFulfillment(ORDER_83)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      status: "Fulfillment created",
      scan_type: "created",
    })
  })

  it("sorts newest first", () => {
    const events = timelineFromFulfillment({
      created_at: "2026-08-01T00:00:00.000Z",
      shipped_at: "2026-08-08T00:00:00.000Z",
      delivered_at: "2026-08-12T00:00:00.000Z",
    })
    expect(events.map((e) => e.scan_type)).toEqual([
      "delivered",
      "shipped",
      "created",
    ])
  })

  it("returns an empty timeline rather than inventing one", () => {
    expect(timelineFromFulfillment({})).toEqual([])
  })
})
