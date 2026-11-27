import {
  courierCodFee,
  courierCodMaxTotal,
  courierCodRefusalMessage,
  decideCourierCod,
} from "../courier-cod"

const OK = {
  country_code: "in",
  currency_code: "inr",
  total: 2400,
  is_design_order: false,
  has_payment_schedule: false,
  delhivery_cod: true as boolean | null,
  max_total: 5000 as number | null,
}

describe("courierCodMaxTotal — ₹15,000 unless overridden", () => {
  it.each([undefined, "", "  "])("defaults to ₹15,000 for %p (on when merged)", (v) => {
    expect(courierCodMaxTotal({ COD_COURIER_MAX_ORDER_TOTAL_INR: v as any })).toBe(15000)
  })
  it.each(["0", "-5", "abc"])("an override of %p switches courier COD off", (v) => {
    expect(courierCodMaxTotal({ COD_COURIER_MAX_ORDER_TOTAL_INR: v })).toBeNull()
  })
  it("reads a positive override", () => {
    expect(courierCodMaxTotal({ COD_COURIER_MAX_ORDER_TOTAL_INR: "5000" })).toBe(5000)
  })
})

describe("courierCodFee — ₹200 unless overridden", () => {
  it("defaults to ₹200", () => {
    expect(courierCodFee({})).toBe(200)
  })
  it("reads an override, including 0 (no fee)", () => {
    expect(courierCodFee({ COD_COURIER_FEE_INR: "150" })).toBe(150)
    expect(courierCodFee({ COD_COURIER_FEE_INR: "0" })).toBe(0)
  })
  it("ignores a nonsense override", () => {
    expect(courierCodFee({ COD_COURIER_FEE_INR: "-3" })).toBe(200)
  })
})

describe("decideCourierCod", () => {
  it("allows a domestic INR cart under the cap on a COD PIN", () => {
    expect(decideCourierCod(OK)).toMatchObject({ allowed: true, reason: "allowed" })
  })

  it.each<[string, Partial<typeof OK>, string]>([
    ["cap unset", { max_total: null }, "disabled"],
    ["abroad", { country_code: "us" }, "not_india"],
    ["not INR", { currency_code: "usd" }, "not_inr"],
    ["design order", { is_design_order: true }, "design_order"],
    ["deposit schedule", { has_payment_schedule: true }, "payment_schedule"],
    ["over the cap", { total: 5000.01 }, "over_cap"],
    ["no total", { total: null as any }, "over_cap"],
    ["Delhivery says no COD", { delhivery_cod: false }, "pin_no_cod"],
    ["Delhivery could not be asked", { delhivery_cod: null }, "pin_unknown"],
  ])("refuses: %s", (_label, patch, reason) => {
    expect(decideCourierCod({ ...OK, ...patch })).toMatchObject({ allowed: false, reason })
  })

  it("allows exactly at the cap", () => {
    expect(decideCourierCod({ ...OK, total: 5000 }).allowed).toBe(true)
  })

  it("names the cap when refusing over it", () => {
    expect(courierCodRefusalMessage(decideCourierCod({ ...OK, total: 9000 }))).toMatch(/5,000/)
  })
})
