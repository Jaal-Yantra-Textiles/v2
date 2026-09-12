import {
  applyPolicyToPrice,
  selectService,
  servicePrice,
  transitDays,
} from "../rate-select"

/**
 * Choosing among Packlink's services.
 *
 * The real Italy→GB response on 2026-09-12 carried EIGHT services spanning
 * €18.19 (Poste Italiane, 3 days) to €116.69 (Fedex International Priority,
 * 2 days) — a 6× spread. `services[0]` over that spread is the same row-order
 * lottery as `stores[0]` and `take: 1`, except it decides what a buyer pays.
 */
const LIVE_IT_GB = [
  { carrier_name: "Poste Italiane", name: "International Plus Home2Home", base_price: "18.19", transit_time: "3 DAYS" },
  { carrier_name: "UPS", name: "Standard Access Point", base_price: "44.35", transit_time: "4 DAYS" },
  { carrier_name: "UPS", name: "Standard", base_price: "46.5", transit_time: "4 DAYS" },
  { carrier_name: "TNT", name: "Economy Express", base_price: "49.59", transit_time: "3 DAYS" },
  { carrier_name: "TNT", name: "Express", base_price: "55.37", transit_time: "2 DAYS" },
  { carrier_name: "UPS", name: "Express Saver", base_price: "62.61", transit_time: "2 DAYS" },
  { carrier_name: "Fedex", name: "Regional Economy", base_price: "86.37", transit_time: "3 DAYS" },
  { carrier_name: "Fedex", name: "International Priority", base_price: "116.69", transit_time: "2 DAYS" },
]

describe("servicePrice", () => {
  it("reads total_price, then base_price", () => {
    expect(servicePrice({ price: { total_price: "21.50" }, base_price: "18.19" })).toBe(21.5)
    expect(servicePrice({ base_price: "18.19" })).toBe(18.19)
  })

  it("treats an unreadable price as ABSENT, never as zero", () => {
    // 🔑 `Number("")` and `Number(null)` are both 0 — a free shipment. These
    // must come back null so the caller falls back instead of shipping free.
    expect(servicePrice({ base_price: "" })).toBeNull()
    expect(servicePrice({ base_price: null as any })).toBeNull()
    expect(servicePrice({})).toBeNull()
    expect(servicePrice({ base_price: "not-a-number" })).toBeNull()
  })

  it("keeps a genuine zero", () => {
    expect(servicePrice({ base_price: 0 })).toBe(0)
  })
})

describe("selectService", () => {
  it("picks the cheapest by default, whatever order they arrive in", () => {
    expect(selectService(LIVE_IT_GB)?.carrier_name).toBe("Poste Italiane")
    expect(selectService([...LIVE_IT_GB].reverse())?.carrier_name).toBe("Poste Italiane")
  })

  it("picks the fastest when asked, breaking ties on price", () => {
    // Three services are 2 DAYS: TNT Express 55.37, UPS Express Saver 62.61,
    // Fedex International Priority 116.69 -> TNT wins on price.
    const s = selectService(LIVE_IT_GB, { prefer: "fastest" })
    expect(s?.carrier_name).toBe("TNT")
    expect(s?.name).toBe("Express")
  })

  it("never lets a service with no stated transit win 'fastest' by default", () => {
    const s = selectService(
      [{ carrier_name: "Mystery", base_price: "5" }, ...LIVE_IT_GB],
      { prefer: "fastest" }
    )
    expect(s?.carrier_name).toBe("TNT")
  })

  it("honours a carrier allowlist", () => {
    const s = selectService(LIVE_IT_GB, { carriers: ["UPS"] })
    expect(s?.carrier_name).toBe("UPS")
    expect(s?.name).toBe("Standard Access Point")
  })

  it("returns null — a REFUSAL — when nothing is quotable", () => {
    // An empty list is Packlink's way of saying it will not carry the lane.
    // Null forces the caller to fall back; a zero would ship it free.
    expect(selectService([])).toBeNull()
    expect(selectService(null)).toBeNull()
    expect(selectService([{ carrier_name: "X", base_price: "" }])).toBeNull()
    expect(selectService(LIVE_IT_GB, { carriers: ["DHL"] })).toBeNull()
  })
})

describe("applyPolicyToPrice", () => {
  it("is at cost by default — no invented margin", () => {
    expect(applyPolicyToPrice(18.19)).toBeCloseTo(18.19, 2)
  })

  it("applies a margin", () => {
    expect(applyPolicyToPrice(18.19, { margin: 1.2 })).toBeCloseTo(21.83, 2)
  })

  it("enforces a floor", () => {
    expect(applyPolicyToPrice(18.19, { minimum: 30 })).toBe(30)
    expect(applyPolicyToPrice(82.32, { minimum: 30 })).toBeCloseTo(82.32, 2)
  })

  it("ignores a nonsensical margin instead of zeroing the price", () => {
    // margin 0 would make shipping free; NaN would make it NaN.
    expect(applyPolicyToPrice(18.19, { margin: 0 })).toBeCloseTo(18.19, 2)
    expect(applyPolicyToPrice(18.19, { margin: NaN })).toBeCloseTo(18.19, 2)
    expect(applyPolicyToPrice(18.19, { margin: -2 })).toBeCloseTo(18.19, 2)
  })

  it("reproduces the four live lanes at cost + 20%", () => {
    // The numbers that showed the flat €30 was loss-making on 3 of 4.
    expect(applyPolicyToPrice(18.19, { margin: 1.2 })).toBeCloseTo(21.83, 2) // GB
    expect(applyPolicyToPrice(31.83, { margin: 1.2 })).toBeCloseTo(38.20, 2) // CA
    expect(applyPolicyToPrice(38.33, { margin: 1.2 })).toBeCloseTo(46.00, 2) // CN
    expect(applyPolicyToPrice(82.32, { margin: 1.2 })).toBeCloseTo(98.78, 2) // AE
  })
})

describe("transitDays", () => {
  it("parses the advertised days, and null when unstated", () => {
    expect(transitDays({ transit_time: "3 DAYS" })).toBe(3)
    expect(transitDays({ transit_time: "2 DAYS" })).toBe(2)
    expect(transitDays({})).toBeNull()
    expect(transitDays({ transit_time: "unknown" })).toBeNull()
  })
})
