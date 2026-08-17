import {
  pickupFromMetadata,
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

/**
 * The pickup code. For Blue Dart this is `TokenNumber`, and it is the ONLY
 * handle that can call a collection off — cancelling the waybill does not. It
 * lived in the shipment widget alone, so whoever asked the tracking question
 * ("has it been collected?") could not see the field they need the moment the
 * answer is "no, and it isn't coming".
 */
describe("pickupFromMetadata", () => {
  it("reads order 83's Blue Dart token", () => {
    expect(
      pickupFromMetadata({
        pickup_id: "4175751",
        pickup_date: "2026-08-17",
        pickup_time: "14:00",
        carrier: "bluedart",
        booked_at: "2026-08-17T05:00:00.000Z",
        pickup_bookings: [{ pickup_id: "4175751" }],
      })
    ).toEqual({
      code: "4175751",
      date: "2026-08-17",
      time: "14:00",
      carrier: "bluedart",
      incoming_center_name: null,
      booked_at: "2026-08-17T05:00:00.000Z",
      bookings_count: 1,
    })
  })

  it("gates on pickup_date, not on the code — a booking with no token is still a courier coming", () => {
    const pickup = pickupFromMetadata({
      pickup_date: "2026-08-17",
      pickup_time: "14:00",
    })
    expect(pickup).not.toBeNull()
    // Null rather than "" so the UI can warn that cancelling needs a phone call.
    expect(pickup!.code).toBeNull()
  })

  it("returns null when no pickup has been recorded", () => {
    expect(pickupFromMetadata(null)).toBeNull()
    expect(pickupFromMetadata({})).toBeNull()
    expect(pickupFromMetadata({ pickup_id: "4175751" })).toBeNull()
  })

  it("counts every booking — a re-book can leave an earlier collection live", () => {
    expect(
      pickupFromMetadata({
        pickup_date: "2026-08-17",
        pickup_bookings: [{ pickup_id: "4175751" }, { pickup_id: "4175752" }],
      })!.bookings_count
    ).toBe(2)
  })

  it("stringifies a numeric token — Blue Dart sends TokenNumber as a number", () => {
    expect(
      pickupFromMetadata({ pickup_id: 4175751, pickup_date: "2026-08-17" })!.code
    ).toBe("4175751")
  })
})
