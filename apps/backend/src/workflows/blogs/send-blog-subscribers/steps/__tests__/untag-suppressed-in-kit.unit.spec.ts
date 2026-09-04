import { untagSuppressedInKit } from "../sync-subscribers-to-kit"

/**
 * The hole this covers (#1782): `untagSubscriber` shipped with a green service
 * spec and NO caller. Not tagging a suppressed address does nothing about an
 * earlier send having already tagged them — the Kit tag is persistent state, so
 * they keep receiving every broadcast.
 *
 * These tests assert the CALL, not the client. Revert the untag loop in
 * `sync-subscribers-to-kit.ts` and the first test fails on `toHaveBeenCalled`.
 */
describe("untagSuppressedInKit", () => {
  const logger = { info: jest.fn(), error: jest.fn() }

  beforeEach(() => jest.clearAllMocks())

  it("untags every suppressed address", async () => {
    const kit = {
      untagSubscriberByEmail: jest.fn(async () => ({
        untagged: true as const,
        reason: "ok" as const,
      })),
    }
    const out = await untagSuppressedInKit(
      kit as any,
      ["a@x.com", "b@x.com"],
      logger,
      0
    )
    expect(kit.untagSubscriberByEmail).toHaveBeenCalledTimes(2)
    expect(kit.untagSubscriberByEmail.mock.calls.map((c: any[]) => c[0])).toEqual([
      "a@x.com",
      "b@x.com",
    ])
    expect(out).toEqual({ untagged: 2, missing: 0, failed: 0 })
  })

  it("counts an address Kit has never seen as missing, not as untagged", async () => {
    const kit = {
      untagSubscriberByEmail: jest.fn(async () => ({
        untagged: false as const,
        reason: "not_found" as const,
      })),
    }
    const out = await untagSuppressedInKit(kit as any, ["ghost@x.com"], logger, 0)
    expect(out).toEqual({ untagged: 0, missing: 1, failed: 0 })
  })

  it("keeps going after a Kit failure and never throws", async () => {
    const kit = {
      untagSubscriberByEmail: jest
        .fn()
        .mockRejectedValueOnce(new Error("Kit API DELETE failed (500)"))
        .mockResolvedValueOnce({ untagged: true, reason: "ok" }),
    }
    const out = await untagSuppressedInKit(
      kit as any,
      ["boom@x.com", "ok@x.com"],
      logger,
      0
    )
    // The second address must still be processed — a broadcast cannot be held
    // hostage by the cleanup of the previous one.
    expect(kit.untagSubscriberByEmail).toHaveBeenCalledTimes(2)
    expect(out).toEqual({ untagged: 1, missing: 0, failed: 1 })
    expect(logger.error).toHaveBeenCalled()
  })

  it("does nothing, and says nothing, when there is nothing suppressed", async () => {
    const kit = { untagSubscriberByEmail: jest.fn() }
    const out = await untagSuppressedInKit(kit as any, [], logger, 0)
    expect(kit.untagSubscriberByEmail).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
    expect(out).toEqual({ untagged: 0, missing: 0, failed: 0 })
  })
})
