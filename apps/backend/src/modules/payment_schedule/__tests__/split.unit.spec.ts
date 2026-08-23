import {
  DEFAULT_DEPOSIT_PCT,
  resolveDepositPct,
  splitDeposit,
} from "../lib/split"

describe("splitDeposit", () => {
  it("splits a round total at the default percentage", () => {
    const s = splitDeposit(1000, 30)
    expect(s.deposit_amount).toBe(300)
    expect(s.balance_amount).toBe(700)
  })

  it("always adds back to the total — the balance is the remainder, not a second percentage", () => {
    // 30% and 70% of this, each rounded independently, do NOT add back.
    for (const total of [1000.05, 33.33, 7777.77, 199999.99, 0.03]) {
      for (const pct of [30, 33.3333, 7, 62.5]) {
        const s = splitDeposit(total, pct)
        expect(s.deposit_amount + s.balance_amount).toBeCloseTo(total, 2)
      }
    }
  })

  it("never returns a negative balance, whatever the percentage says", () => {
    expect(splitDeposit(500, 140).balance_amount).toBe(0)
    expect(splitDeposit(500, 140).deposit_amount).toBe(500)
    expect(splitDeposit(500, -20).deposit_amount).toBe(0)
    expect(splitDeposit(500, -20).balance_amount).toBe(500)
  })

  it("treats 0% and 100% as legitimate terms, not as errors", () => {
    expect(splitDeposit(900, 0)).toMatchObject({
      deposit_amount: 0,
      balance_amount: 900,
    })
    expect(splitDeposit(900, 100)).toMatchObject({
      deposit_amount: 900,
      balance_amount: 0,
    })
  })

  it("falls back to the platform default when the percentage is unusable", () => {
    expect(splitDeposit(1000, null).deposit_pct).toBe(DEFAULT_DEPOSIT_PCT)
    expect(splitDeposit(1000, undefined).deposit_pct).toBe(DEFAULT_DEPOSIT_PCT)
    expect(splitDeposit(1000, Number.NaN).deposit_pct).toBe(DEFAULT_DEPOSIT_PCT)
  })

  it("refuses to invent money from a nonsense total", () => {
    expect(splitDeposit(Number.NaN, 30)).toMatchObject({
      deposit_amount: 0,
      balance_amount: 0,
    })
    expect(splitDeposit(-100, 30)).toMatchObject({
      deposit_amount: 0,
      balance_amount: 0,
    })
  })

  it("rounds the half-up case that floating point gets wrong", () => {
    // 1.005 * 100 is 100.49999999999999 in IEEE-754, so a naive
    // Math.round(x * 100) / 100 rounds this DOWN to 1.00.
    expect(splitDeposit(3.35, 30).deposit_amount).toBe(1.01)
  })
})

describe("resolveDepositPct", () => {
  it("prefers the deal, then the partner's terms, then the platform default", () => {
    expect(resolveDepositPct(45, 20)).toBe(45)
    expect(resolveDepositPct(null, 20)).toBe(20)
    expect(resolveDepositPct(null, null)).toBe(DEFAULT_DEPOSIT_PCT)
    expect(resolveDepositPct(undefined, undefined)).toBe(DEFAULT_DEPOSIT_PCT)
  })

  it("🔑 treats 0 as an answer, not as absence", () => {
    // A partner who agreed to take nothing up front means it. `||` would have
    // silently replaced this with 30%.
    expect(resolveDepositPct(0, 20)).toBe(0)
    expect(resolveDepositPct(null, 0)).toBe(0)
  })
})
