import { selectAddressesToUntag } from "../sync-subscribers-to-kit"

/**
 * 2026-10-07: 15 test addresses were suppressed (reason "manual") that morning.
 * getSubscribersStep dropped them as bounced, so the sync step's audience never
 * contained them, the untag set built from that audience was empty, and the
 * Luna broadcast still reached them through the tag an earlier send had set.
 * The untag set must come from the ledger, intersected with the tag.
 */
describe("selectAddressesToUntag", () => {
  it("untags a suppressed address that is on the tag but not in this audience", () => {
    const out = selectAddressesToUntag(
      [{ email: "ops-test@jaalyantra.com", reason: "manual" }],
      ["ops-test@jaalyantra.com", "real@x.com"]
    )
    expect([...out]).toEqual(["ops-test@jaalyantra.com"])
  })

  it("leaves soft bounces on the tag (they are logged, not suppressed)", () => {
    const out = selectAddressesToUntag(
      [{ email: "full@x.com", reason: "soft_bounce" }],
      ["full@x.com"]
    )
    expect(out.size).toBe(0)
  })

  it("skips ledger addresses that are not on the tag (no wasted Kit calls)", () => {
    const out = selectAddressesToUntag(
      [{ email: "gone@x.com", reason: "hard_bounce" }],
      ["real@x.com"]
    )
    expect(out.size).toBe(0)
  })

  it("matches case-insensitively and keeps this audience's own suppressed", () => {
    const out = selectAddressesToUntag(
      [{ email: "Unsub@X.com", reason: "unsubscribe" }],
      ["unsub@x.com"],
      ["audience-suppressed@x.com"]
    )
    expect([...out].sort()).toEqual(["audience-suppressed@x.com", "unsub@x.com"])
  })
})
