import { describe, expect, it } from "vitest"

import { carrierLabel, isBookingPending } from "./carrier-label"

describe("carrierLabel", () => {
  it("names the known carriers", () => {
    expect(carrierLabel("dtdc")).toBe("DTDC")
    expect(carrierLabel("india_post")).toBe("India Post")
    expect(carrierLabel("delhivery")).toBe("Delhivery")
    expect(carrierLabel("shiprocket")).toBe("Shiprocket")
  })

  it("title-cases an unknown id instead of showing snake_case", () => {
    expect(carrierLabel("blue_dart")).toBe("Blue Dart")
  })

  it("returns empty for a missing carrier", () => {
    expect(carrierLabel(null)).toBe("")
    expect(carrierLabel(undefined)).toBe("")
  })
})

describe("isBookingPending", () => {
  it("is true only for booking_pending", () => {
    expect(isBookingPending({ status: "booking_pending" })).toBe(true)
    expect(isBookingPending({ status: "pickup_scheduled" })).toBe(false)
    expect(isBookingPending({ status: "created" })).toBe(false)
    expect(isBookingPending(null)).toBe(false)
  })
})
