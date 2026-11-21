import { planManualDeposit } from "../manual-deposit"

const pct70 = { id: "s1", source_type: "manual", deposit_status: "pending", deposit_pct: 70, deposit_amount: 1 }

describe("planManualDeposit", () => {
  it("takes the schedule's % of the TAXED total", () => {
    expect(planManualDeposit({ schedule: pct70, taxedTotal: 29398.69 })).toEqual({
      ok: true,
      deposit: 20579.08,
      balance: 8819.61,
      total: 29398.69,
    })
  })

  it("uses what actually arrived when given", () => {
    expect(planManualDeposit({ schedule: pct70, taxedTotal: 29398.69, amountReceived: 20000 })).toEqual({
      ok: true,
      deposit: 20000,
      balance: 9398.69,
      total: 29398.69,
    })
  })

  it("uses a fixed deposit amount as stored", () => {
    const fixed = { ...pct70, deposit_pct: null, deposit_amount: 800 }
    expect(planManualDeposit({ schedule: fixed, taxedTotal: 8400 })).toMatchObject({ ok: true, deposit: 800, balance: 7600 })
  })

  it("works without a schedule only when amount_received is given", () => {
    expect(planManualDeposit({ schedule: null, taxedTotal: 1000 }).ok).toBe(false)
    expect(planManualDeposit({ schedule: null, taxedTotal: 1000, amountReceived: 300 })).toMatchObject({ ok: true, balance: 700 })
  })

  it.each([[0], [-5], [null as any], ["500" as any]])("refuses amount_received %p that is not a positive number", (a) => {
    // null is treated as "not given" → falls back to the schedule
    const out = planManualDeposit({ schedule: a === null ? null : pct70, taxedTotal: 1000, amountReceived: a })
    expect(out.ok).toBe(false)
  })

  it("🔴 refuses a deposit that is the whole total — that is 'prepaid'", () => {
    expect(planManualDeposit({ schedule: pct70, taxedTotal: 1000, amountReceived: 1000 }).ok).toBe(false)
  })

  it("refuses an already-paid or quote deposit", () => {
    expect(planManualDeposit({ schedule: { ...pct70, deposit_status: "paid" }, taxedTotal: 1000 }).ok).toBe(false)
    expect(planManualDeposit({ schedule: { ...pct70, source_type: "quote" }, taxedTotal: 1000 }).ok).toBe(false)
  })
})
