/**
 * The send-to-partner rollback must tell a kickoff failure (undo the
 * assignment) from the 23-day wait running out (keep the partner, tell a
 * person). 2026-10-05: the wait expiring unlinked JP Handloom from its order.
 */
import { isWaitExpiry, KICKOFF_GRACE_MS } from "../wait-expiry"

const NOW = Date.parse("2026-10-05T10:36:29.000Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe("isWaitExpiry", () => {
  it("a rollback seconds after the assignment is a kickoff failure", () => {
    expect(isWaitExpiry(ago(5_000), NOW)).toBe(false)
  })

  it("a rollback 23 days after the assignment is the wait running out", () => {
    // The real case: sent 2026-09-12T10:36:13Z, rolled back 23 days later.
    expect(isWaitExpiry("2026-09-12T10:36:13.300Z", NOW)).toBe(true)
  })

  it("the boundary is the kickoff grace", () => {
    expect(isWaitExpiry(ago(KICKOFF_GRACE_MS - 1_000), NOW)).toBe(false)
    expect(isWaitExpiry(ago(KICKOFF_GRACE_MS + 1_000), NOW)).toBe(true)
  })

  it("with no readable timestamp it does NOT claim expiry (old behaviour)", () => {
    expect(isWaitExpiry(undefined, NOW)).toBe(false)
    expect(isWaitExpiry(null, NOW)).toBe(false)
    expect(isWaitExpiry("not a date", NOW)).toBe(false)
  })
})
