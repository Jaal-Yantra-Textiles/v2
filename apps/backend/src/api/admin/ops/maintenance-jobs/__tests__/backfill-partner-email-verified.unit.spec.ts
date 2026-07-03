import {
  decidePartnerVerifyAction,
  backfillPartnerEmailVerifiedJob,
} from "../backfill-partner-email-verified-job"

/**
 * Unit test — decidePartnerVerifyAction (#858 tail backfill).
 * Pure decision: skip already-verified, set verified_at on requested rows,
 * create a verified row when none exists. No DI, no DB.
 */
describe("decidePartnerVerifyAction", () => {
  it("skips an already-verified identity (row has verified_at)", () => {
    expect(decidePartnerVerifyAction({ verified_at: new Date() })).toBe(
      "already_verified"
    )
    expect(
      decidePartnerVerifyAction({ verified_at: "2026-01-01T00:00:00Z" })
    ).toBe("already_verified")
  })

  it("updates a requested-but-unconfirmed row (verified_at null/absent)", () => {
    expect(decidePartnerVerifyAction({ verified_at: null })).toBe("update")
    expect(decidePartnerVerifyAction({})).toBe("update")
  })

  it("creates a verified row when there is no verification yet", () => {
    expect(decidePartnerVerifyAction(undefined)).toBe("create")
    expect(decidePartnerVerifyAction(null)).toBe("create")
  })
})

describe("backfillPartnerEmailVerifiedJob metadata", () => {
  it("is registered with the expected id + params", () => {
    expect(backfillPartnerEmailVerifiedJob.id).toBe(
      "backfill-partner-email-verified"
    )
    const names = backfillPartnerEmailVerifiedJob.params.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(["partner_id", "limit"]))
  })
})
