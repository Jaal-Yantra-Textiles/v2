import { describe, expect, it } from "vitest"
import {
  buildSalePayload,
  hasProfitShareDeal,
  localDateInputValue,
  saleLineTotal,
  soldAtFromDateInput,
  toIsoWithOffset,
} from "./profit-share"

const summary = (owed: number | null) =>
  ({
    percent: owed === null ? null : 20,
    currency_code: "inr",
    run_quantity: 10,
    sold_quantity: 0,
    unsold_quantity: 10,
    gross_sales: 0,
    owed,
    paid: 0,
    balance: owed,
    status: owed === null ? "none" : "no_sales",
    currency_mismatch: false,
    working: [],
  }) as any

// The server's own z.string().datetime({ offset: true }) shape.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

describe("profit share sheet (#2401)", () => {
  it("shows nothing for a run with no deal — owed null is not ₹0", () => {
    expect(hasProfitShareDeal(undefined)).toBe(false)
    expect(
      hasProfitShareDeal({ percent: null, summary: summary(null) } as any)
    ).toBe(false)
  })

  it("shows the sheet once there is a percent, even before any sale", () => {
    expect(
      hasProfitShareDeal({ percent: 20, summary: summary(0) } as any)
    ).toBe(true)
  })

  it("coerces string / bigNumber prices on a sale line", () => {
    expect(saleLineTotal({ quantity: 4, unit_price: "2500" })).toBe(10000)
    expect(saleLineTotal({ quantity: "3", unit_price: "1499.5" })).toBe(4498.5)
  })

  it("stamps a past date at local noon, with an offset the server accepts", () => {
    const now = new Date(2026, 9, 13, 9, 30, 0)
    const iso = soldAtFromDateInput("2026-10-01", now)!
    expect(iso).toMatch(ISO_WITH_OFFSET)
    expect(iso.startsWith("2026-10-01T12:00:00")).toBe(true)
    // Round-trips to the same local calendar day.
    expect(localDateInputValue(new Date(iso))).toBe("2026-10-01")
  })

  it("stamps today with the current time, not a future noon", () => {
    const now = new Date(2026, 9, 13, 9, 30, 15)
    expect(soldAtFromDateInput("2026-10-13", now)).toBe(toIsoWithOffset(now))
  })

  it("rejects a non-positive quantity or price and a missing date", () => {
    const base = { quantity: "4", unitPrice: "2500", soldOn: "2026-10-01", note: "" }
    expect(buildSalePayload({ ...base, quantity: "0" })).toEqual({ ok: false, error: "quantity" })
    expect(buildSalePayload({ ...base, quantity: "" })).toEqual({ ok: false, error: "quantity" })
    expect(buildSalePayload({ ...base, unitPrice: "-1" })).toEqual({ ok: false, error: "unitPrice" })
    expect(buildSalePayload({ ...base, soldOn: "" })).toEqual({ ok: false, error: "soldOn" })
  })

  it("builds the POST body, dropping an empty note", () => {
    const res = buildSalePayload({
      quantity: "4",
      unitPrice: "2500",
      soldOn: "2026-10-01",
      note: "  ",
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error("unreachable")
    expect(res.payload).toMatchObject({ quantity: 4, unit_price: 2500 })
    expect(res.payload.sold_at).toMatch(ISO_WITH_OFFSET)
    expect("note" in res.payload).toBe(false)

    const withNote = buildSalePayload({
      quantity: "1",
      unitPrice: "900",
      soldOn: "2026-10-01",
      note: " Diwali stall ",
    })
    expect(withNote.ok && withNote.payload.note).toBe("Diwali stall")
  })
})
