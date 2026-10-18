import {
  includeCancelledQueryParam,
  partnerRunStatusFilter,
  partnerWorkOrderStatusFilter,
} from "../partner-cancelled-visibility"

describe("partner lists hide cancelled unless asked for", () => {
  it("excludes cancelled runs by default", () => {
    expect(partnerRunStatusFilter(undefined, undefined)).toEqual({ $ne: "cancelled" })
    expect(partnerRunStatusFilter(undefined, false)).toEqual({ $ne: "cancelled" })
  })

  it("an explicit status wins: asking for cancelled shows cancelled", () => {
    expect(partnerRunStatusFilter("cancelled", false)).toBe("cancelled")
    expect(partnerRunStatusFilter("in_progress", false)).toBe("in_progress")
  })

  it("include_cancelled drops the status filter entirely", () => {
    expect(partnerRunStatusFilter(undefined, true)).toBeUndefined()
  })

  it("work orders spell it with one l, as the order status does", () => {
    expect(partnerWorkOrderStatusFilter(undefined, false)).toEqual({ $ne: "canceled" })
    expect(partnerWorkOrderStatusFilter("", false)).toEqual({ $ne: "canceled" })
    expect(partnerWorkOrderStatusFilter("canceled", false)).toBe("canceled")
    expect(partnerWorkOrderStatusFilter(undefined, true)).toBeUndefined()
  })

  it("only the literal 'true' opts in", () => {
    expect(includeCancelledQueryParam.parse("true")).toBe(true)
    expect(includeCancelledQueryParam.parse("false")).toBe(false)
    expect(includeCancelledQueryParam.parse(undefined)).toBe(false)
    expect(() => includeCancelledQueryParam.parse("yes")).toThrow()
  })
})
