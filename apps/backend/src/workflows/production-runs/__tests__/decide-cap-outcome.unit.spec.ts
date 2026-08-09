import { decideCapOutcome } from "../emit-production-run-reminder"

/**
 * #1228 — the reminder cap no longer parks a run unconditionally. It may first
 * spend a "same partner retry" from the stored policy budget. These cases pin
 * the boundary, including the `same_partner_retries: 0` setting that restores
 * the original #1093 behaviour.
 */
describe("decideCapOutcome", () => {
  it("retries the same partner while budget remains", () => {
    expect(
      decideCapOutcome({ reassign_retry_count: 0 }, { same_partner_retries: 1 })
    ).toEqual({ outcome: "retry_same_partner", nextRetryCount: 1 })
  })

  it("parks once the budget is spent", () => {
    expect(
      decideCapOutcome({ reassign_retry_count: 1 }, { same_partner_retries: 1 })
    ).toEqual({ outcome: "park", nextRetryCount: 1 })
  })

  it("parks immediately when retries are disabled (pre-#1228 behaviour)", () => {
    expect(
      decideCapOutcome({ reassign_retry_count: 0 }, { same_partner_retries: 0 })
    ).toEqual({ outcome: "park", nextRetryCount: 0 })
  })

  it("supports a larger budget across successive caps", () => {
    const policy = { same_partner_retries: 2 }
    expect(decideCapOutcome({ reassign_retry_count: 0 }, policy).outcome).toBe(
      "retry_same_partner"
    )
    expect(decideCapOutcome({ reassign_retry_count: 1 }, policy).outcome).toBe(
      "retry_same_partner"
    )
    expect(decideCapOutcome({ reassign_retry_count: 2 }, policy).outcome).toBe("park")
  })

  it("treats a null/absent counter as zero spent", () => {
    expect(
      decideCapOutcome({ reassign_retry_count: null }, { same_partner_retries: 1 })
    ).toEqual({ outcome: "retry_same_partner", nextRetryCount: 1 })
    expect(decideCapOutcome({}, { same_partner_retries: 1 })).toEqual({
      outcome: "retry_same_partner",
      nextRetryCount: 1,
    })
  })

  it("never retries when the stored counter has somehow overshot the budget", () => {
    expect(
      decideCapOutcome({ reassign_retry_count: 9 }, { same_partner_retries: 1 })
    ).toEqual({ outcome: "park", nextRetryCount: 9 })
  })
})
