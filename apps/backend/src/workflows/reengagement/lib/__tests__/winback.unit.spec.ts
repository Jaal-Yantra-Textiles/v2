import {
  buildWinbackEmailData,
  humanizeDaysSince,
  selectWinbackDue,
  winbackOnCooldown,
} from "../winback"

const NOW = new Date("2026-06-24T10:00:00.000Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

const baseRow = (over: Record<string, any> = {}) => ({
  id: "cus_1",
  email: "buyer@example.com",
  first_name: "Asha",
  order_count: 2,
  last_order_at: daysAgo(120),
  last_order_display: 1042,
  metadata: {},
  ...over,
})

describe("selectWinbackDue", () => {
  it("returns lapsed customers older than minLapsedDays with an order + email", () => {
    const due = selectWinbackDue([baseRow()], { now: NOW, minLapsedDays: 90 })
    expect(due.map((d) => d.id)).toEqual(["cus_1"])
  })

  it("skips customers whose last order is younger than minLapsedDays", () => {
    const due = selectWinbackDue([baseRow({ last_order_at: daysAgo(30) })], {
      now: NOW,
      minLapsedDays: 90,
    })
    expect(due).toEqual([])
  })

  it("skips customers with no orders or no email", () => {
    const rows = [
      baseRow({ id: "no-orders", order_count: 0, last_order_at: null }),
      baseRow({ id: "no-email", email: "" }),
      baseRow({ id: "null-email", email: null }),
    ]
    expect(selectWinbackDue(rows, { now: NOW, minLapsedDays: 90 })).toEqual([])
  })

  it("skips customers win-backed within the cooldown window (idempotency)", () => {
    const onCooldown = baseRow({
      metadata: { winback_sent_at: daysAgo(30).toISOString() },
    })
    expect(
      selectWinbackDue([onCooldown], {
        now: NOW,
        minLapsedDays: 90,
        cooldownDays: 180,
      })
    ).toEqual([])

    // ...but re-eligible once the cooldown has elapsed.
    const cooledOff = baseRow({
      metadata: { winback_sent_at: daysAgo(200).toISOString() },
    })
    expect(
      selectWinbackDue([cooledOff], {
        now: NOW,
        minLapsedDays: 90,
        cooldownDays: 180,
      }).map((d) => d.id)
    ).toEqual(["cus_1"])
  })

  it("sorts longest-lapsed first and caps at maxBatch", () => {
    const rows = [
      baseRow({ id: "a", last_order_at: daysAgo(100) }),
      baseRow({ id: "b", last_order_at: daysAgo(300) }),
      baseRow({ id: "c", last_order_at: daysAgo(200) }),
    ]
    const due = selectWinbackDue(rows, {
      now: NOW,
      minLapsedDays: 90,
      maxBatch: 2,
    })
    expect(due.map((d) => d.id)).toEqual(["b", "c"])
  })

  it("handles empty / nullish input", () => {
    expect(selectWinbackDue(undefined)).toEqual([])
    expect(selectWinbackDue(null as any)).toEqual([])
    expect(selectWinbackDue([])).toEqual([])
  })
})

describe("winbackOnCooldown", () => {
  it("true within cooldown, false outside / when never sent", () => {
    expect(
      winbackOnCooldown(
        { id: "c", metadata: { winback_sent_at: daysAgo(10).toISOString() } },
        NOW,
        180
      )
    ).toBe(true)
    expect(
      winbackOnCooldown(
        { id: "c", metadata: { winback_sent_at: daysAgo(190).toISOString() } },
        NOW,
        180
      )
    ).toBe(false)
    expect(winbackOnCooldown({ id: "c", metadata: {} }, NOW, 180)).toBe(false)
  })
})

describe("humanizeDaysSince", () => {
  it("formats days, weeks and months", () => {
    expect(humanizeDaysSince(1)).toBe("1 day")
    expect(humanizeDaysSince(5)).toBe("5 days")
    expect(humanizeDaysSince(21)).toBe("3 weeks")
    expect(humanizeDaysSince(120)).toBe("4 months")
  })
})

describe("buildWinbackEmailData", () => {
  it("builds the win-back payload with display id, days-since and shop url", () => {
    const out = buildWinbackEmailData({
      customer: baseRow({ last_order_at: daysAgo(90) }),
      shopBase: "https://shop.example.com",
      now: NOW,
    })
    expect(out.template).toBe("win-back")
    expect(out.to).toBe("buyer@example.com")
    expect(out.data.customer_name).toBe("Asha")
    expect(out.data.last_order_display).toBe("#1042")
    expect(out.data.days_since).toBe("3 months")
    expect(out.data.shop_url).toBe("https://shop.example.com")
    expect(out.data.current_year).toBe(2026)
  })

  it("falls back to 'there', empty display and empty recipient", () => {
    const out = buildWinbackEmailData({
      customer: {
        id: "cus_9",
        email: "",
        last_order_at: null,
        last_order_display: null,
      },
      shopBase: "",
      now: NOW,
    })
    expect(out.to).toBe("")
    expect(out.data.customer_name).toBe("there")
    expect(out.data.last_order_display).toBe("")
    expect(out.data.days_since).toBe("")
    expect(out.data.shop_url).toBe("")
  })
})
