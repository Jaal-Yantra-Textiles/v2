/**
 * Unit test — pickFeeRate / resolvePartnerFeeRate (#336 Slice 1)
 *
 * Pure fee-rate resolution with override > env-default > hard-default precedence.
 * No DI, no DB.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="resolve-fee-rate"
 */
import {
  pickFeeRate,
  resolvePartnerFeeRate,
  PLATFORM_DEFAULT_FEE_BPS,
} from "../lib/resolve-fee-rate"

describe("pickFeeRate", () => {
  it("prefers a valid per-partner override over the default", () => {
    expect(pickFeeRate(350, 200)).toEqual({
      fee_basis: "percentage",
      fee_rate: 350,
    })
  })

  it("allows an explicit 0 bps override (fee-waived partner)", () => {
    expect(pickFeeRate(0, 200)).toEqual({
      fee_basis: "percentage",
      fee_rate: 0,
    })
  })

  it("truncates a fractional override to an integer", () => {
    expect(pickFeeRate(250.9, 200).fee_rate).toBe(250)
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", NaN],
    ["negative", -10],
    ["Infinity", Infinity],
  ])("falls back to the default when override is %s", (_label, override) => {
    expect(pickFeeRate(override as any, 200)).toEqual({
      fee_basis: "percentage",
      fee_rate: 200,
    })
  })
})

describe("resolvePartnerFeeRate", () => {
  const ORIGINAL = process.env.PLATFORM_TX_FEE_BPS

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PLATFORM_TX_FEE_BPS
    } else {
      process.env.PLATFORM_TX_FEE_BPS = ORIGINAL
    }
  })

  it("resolves the hard-coded 2% default when env is unset", async () => {
    delete process.env.PLATFORM_TX_FEE_BPS
    await expect(resolvePartnerFeeRate(null, { partnerId: "p_1" })).resolves.toEqual(
      { fee_basis: "percentage", fee_rate: PLATFORM_DEFAULT_FEE_BPS }
    )
  })

  it("resolves the env-configured platform default", async () => {
    process.env.PLATFORM_TX_FEE_BPS = "500"
    await expect(resolvePartnerFeeRate(null)).resolves.toEqual({
      fee_basis: "percentage",
      fee_rate: 500,
    })
  })

  it("falls back to the default on an invalid env value", async () => {
    process.env.PLATFORM_TX_FEE_BPS = "garbage"
    const r = await resolvePartnerFeeRate(null, { partnerId: "p_1" })
    expect(r.fee_rate).toBe(PLATFORM_DEFAULT_FEE_BPS)
  })

  it("never throws and ignores partnerId today (overrides deferred)", async () => {
    process.env.PLATFORM_TX_FEE_BPS = "200"
    const withPartner = await resolvePartnerFeeRate(null, { partnerId: "p_x" })
    const without = await resolvePartnerFeeRate(null)
    expect(withPartner).toEqual(without)
  })
})
