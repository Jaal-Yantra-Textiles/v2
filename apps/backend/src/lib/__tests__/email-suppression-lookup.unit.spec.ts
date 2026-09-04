/**
 * #1339 — the provider-side guard: reading the ledger and applying the policy.
 *
 * The behaviours that matter most here are the failure ones. A guard that
 * cannot run must SEND and must SAY SO — "not enforced" and "nothing to
 * suppress" look identical otherwise, which is the exact ambiguity that let
 * this ledger sit unread for months.
 */
import {
  createSuppressionGuard,
  createSuppressionLookup,
  partitionSuppressedRecipients,
  SUPPRESSION_CACHE_TTL_MS,
} from "../email-suppression-lookup"

const makeLogger = () => ({
  warn: jest.fn((_msg: string) => undefined),
  error: jest.fn((_msg: string) => undefined),
  info: jest.fn((_msg: string) => undefined),
  debug: jest.fn((_msg: string) => undefined),
})

const pgReturning = (...reasons: string[]) => ({
  raw: jest.fn(async (_sql: string, _bindings?: unknown[]) => ({
    rows: reasons.map((reason) => ({ reason })),
  })),
})

describe("email suppression guard", () => {
  it("suppresses a hard bounce on the transactional channel", async () => {
    const logger = makeLogger()
    const guard = createSuppressionGuard({
      pg: pgReturning("hard_bounce"),
      logger: logger as any,
      provider: "resend",
      channel: "email",
    })

    const verdict = await guard("dead@example.com", "order-shipment-delivered")

    expect(verdict.suppress).toBe(true)
    expect(verdict.id).toContain("suppressed")
    // Assert on the recorded call, not inside the mock — an expect() thrown
    // inside a mock can be swallowed by the code under test.
    const lines = logger.warn.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes("[email-suppressed]"))).toBe(true)
    expect(lines.some((l) => l.includes("reason=hard_bounce"))).toBe(true)
  })

  it("sends when the ledger has nothing on the address", async () => {
    const logger = makeLogger()
    const guard = createSuppressionGuard({
      pg: pgReturning(),
      logger: logger as any,
      provider: "resend",
      channel: "email",
    })

    const verdict = await guard("fine@example.com", "order-shipment-delivered")

    expect(verdict.suppress).toBe(false)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  describe("the partner carve-out", () => {
    it("delivers a partner's mail after their spam complaint, and raises an alert", async () => {
      const logger = makeLogger()
      const guard = createSuppressionGuard({
        pg: pgReturning("spam_complaint"),
        logger: logger as any,
        provider: "maileroo",
        channel: "email_partner",
      })

      const verdict = await guard("partner@example.com", "partner-quote-issued")

      expect(verdict.suppress).toBe(false)
      const lines = logger.warn.mock.calls.map((c) => String(c[0]))
      expect(lines.some((l) => l.includes("[partner-spam-complaint]"))).toBe(true)
    })

    it("still blocks a partner address that hard-bounced", async () => {
      const logger = makeLogger()
      const guard = createSuppressionGuard({
        pg: pgReturning("hard_bounce"),
        logger: logger as any,
        provider: "maileroo",
        channel: "email_partner",
      })

      expect((await guard("gone@example.com", "partner-quote-issued")).suppress).toBe(true)
    })
  })

  describe("failing open, loudly", () => {
    it("sends and logs an error when the query throws", async () => {
      const logger = makeLogger()
      const pg = {
        raw: jest.fn(async (_sql: string, _bindings?: unknown[]) => {
          throw new Error("connection terminated")
        }),
      }
      const guard = createSuppressionGuard({
        pg,
        logger: logger as any,
        provider: "resend",
        channel: "email",
      })

      const verdict = await guard("someone@example.com", "cart-abandoned")

      expect(verdict.suppress).toBe(false)
      const errors = logger.error.mock.calls.map((c) => String(c[0]))
      expect(errors.some((l) => l.includes("[email-suppression-lookup-failed]"))).toBe(true)
      expect(errors.some((l) => l.includes("sent without consulting the ledger"))).toBe(true)
    })

    it("sends and says the guard is not running when there is no connection", async () => {
      const logger = makeLogger()
      const guard = createSuppressionGuard({
        pg: undefined,
        logger: logger as any,
        provider: "resend",
        channel: "email",
      })

      expect((await guard("a@example.com")).suppress).toBe(false)
      const errors = logger.error.mock.calls.map((c) => String(c[0]))
      expect(errors.some((l) => l.includes("[email-suppression-unavailable]"))).toBe(true)
      expect(errors.some((l) => l.includes("NOT being enforced"))).toBe(true)
    })

    it("does not repeat the missing-connection error on every send", async () => {
      const logger = makeLogger()
      const guard = createSuppressionGuard({
        pg: null,
        logger: logger as any,
        provider: "resend",
        channel: "email",
      })

      await guard("a@example.com")
      await guard("b@example.com")
      await guard("c@example.com")

      expect(logger.error).toHaveBeenCalledTimes(1)
    })
  })

  describe("caching", () => {
    it("reuses a result within the TTL and re-queries after it", async () => {
      const logger = makeLogger()
      const pg = pgReturning("hard_bounce")
      let clock = 1_000
      const lookup = createSuppressionLookup({
        pg,
        logger: logger as any,
        provider: "resend",
        now: () => clock,
      })

      await lookup("x@example.com")
      await lookup("x@example.com")
      expect(pg.raw).toHaveBeenCalledTimes(1)

      clock += SUPPRESSION_CACHE_TTL_MS + 1
      await lookup("x@example.com")
      expect(pg.raw).toHaveBeenCalledTimes(2)
    })

    it("normalizes the address so casing and display names share a cache entry", async () => {
      const logger = makeLogger()
      const pg = pgReturning()
      const lookup = createSuppressionLookup({
        pg,
        logger: logger as any,
        provider: "resend",
      })

      await lookup("Foo@Example.com")
      await lookup("  foo@example.com ")
      await lookup("Foo Bar <foo@example.com>")

      expect(pg.raw).toHaveBeenCalledTimes(1)
    })

    it("never queries for an empty address", async () => {
      const logger = makeLogger()
      const pg = pgReturning()
      const lookup = createSuppressionLookup({ pg, logger: logger as any, provider: "resend" })

      expect(await lookup("")).toEqual([])
      expect(pg.raw).not.toHaveBeenCalled()
    })
  })

  describe("bulk", () => {
    it("splits a batch into sendable and suppressed", async () => {
      const logger = makeLogger()
      const pg = {
        raw: jest.fn(async (_sql: string, bindings?: unknown[]) => {
          const email = String((bindings ?? [])[0] ?? "")
          return { rows: email === "dead@example.com" ? [{ reason: "hard_bounce" }] : [] }
        }),
      }
      const guard = createSuppressionGuard({
        pg,
        logger: logger as any,
        provider: "mailjet",
        channel: "email_bulk",
      })

      const entries = [
        { to: "ok@example.com" },
        { to: "dead@example.com" },
        { to: "also-ok@example.com" },
      ]
      const { send, suppressed } = await partitionSuppressedRecipients(
        entries,
        (e) => e.to,
        guard
      )

      expect(send.map((e) => e.to)).toEqual(["ok@example.com", "also-ok@example.com"])
      expect(suppressed.map((e) => e.to)).toEqual(["dead@example.com"])
    })
  })
})
