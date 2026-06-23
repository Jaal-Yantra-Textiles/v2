import {
  buildIdeasEmailGenerateResult,
  buildIdeasEmailSendExistingResult,
  parseRecipientsCsv,
} from "../registry"

/**
 * Pure-unit coverage for the run-marketing-ideas-email job's container-free
 * helpers. The container-bound run() (LLM generation, guard, send) is exercised
 * by the workflow integration test; here we lock down the CSV parser and the
 * two result builders without booting the DB or invoking any workflow.
 */
describe("run-marketing-ideas-email — parseRecipientsCsv", () => {
  it("returns undefined for undefined input", () => {
    expect(parseRecipientsCsv(undefined)).toBeUndefined()
  })

  it("returns undefined for null input", () => {
    expect(parseRecipientsCsv(null)).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(parseRecipientsCsv("")).toBeUndefined()
  })

  it("returns undefined for whitespace-only string", () => {
    expect(parseRecipientsCsv("   ")).toBeUndefined()
  })

  it("parses a comma-separated string with trimming and blank dropping", () => {
    expect(parseRecipientsCsv("a@x.com, b@y.com ,")).toEqual([
      "a@x.com",
      "b@y.com",
    ])
  })

  it("parses an array with trimming and blank dropping", () => {
    expect(parseRecipientsCsv([" a@x.com ", "b@y.com", ""])).toEqual([
      "a@x.com",
      "b@y.com",
    ])
  })

  it("returns undefined for a non-array/non-string input", () => {
    expect(parseRecipientsCsv(123)).toBeUndefined()
  })
})

describe("run-marketing-ideas-email — buildIdeasEmailGenerateResult", () => {
  it("dry-run, generated, guard-passed: previews would-send and reports no apply", () => {
    const result = buildIdeasEmailGenerateResult(
      "run-marketing-ideas-email",
      true,
      {
        generated: true,
        guard_passed: true,
        log_id: "log_1",
        send_enabled: false,
        send_attempted: false,
        sent: 0,
        skipped_reason: null,
        errored: false,
      }
    )
    expect(result.job_id).toBe("run-marketing-ideas-email")
    expect(result.dry_run).toBe(true)
    expect(result.applied).toBe(false)
    expect(result.summary).toMatch(/Dry-run/)
    expect(result.summary).toMatch(/would send/)
    expect(result.changes.find((c) => c.field === "generated")?.id).toBe(
      "log_1"
    )
    const sentChange = result.changes.find((c) => c.field === "sent")
    expect(sentChange?.after).toBe("(would send)")
    expect(sentChange?.before).toBe(false)
  })

  it("apply, generated, guard-passed, sent > 0: reports applied and sent", () => {
    const result = buildIdeasEmailGenerateResult("jid", false, {
      generated: true,
      guard_passed: true,
      log_id: "log_2",
      send_enabled: true,
      send_attempted: true,
      sent: 2,
      skipped_reason: null,
      errored: false,
    })
    expect(result.applied).toBe(true)
    const sentChange = result.changes.find((c) => c.field === "sent")
    expect(sentChange?.after).toBe(true)
    expect(result.summary).toMatch(/sent to 2/)
  })

  it("guard failed: no sent change, summary contains FAILED, not applied", () => {
    const result = buildIdeasEmailGenerateResult("jid", false, {
      generated: true,
      guard_passed: false,
      log_id: "log_3",
      send_enabled: true,
      send_attempted: false,
      sent: 0,
      skipped_reason: "not_guard_passed",
      errored: false,
    })
    expect(result.changes.find((c) => c.field === "sent")).toBeUndefined()
    expect(result.summary).toMatch(/FAILED/)
    expect(result.applied).toBe(false)
  })

  it("not generated: no generated change, not applied", () => {
    const result = buildIdeasEmailGenerateResult("jid", true, {
      generated: false,
      guard_passed: false,
      log_id: null,
      send_enabled: false,
      send_attempted: false,
      sent: 0,
      skipped_reason: "no_snapshots",
      errored: false,
    })
    expect(result.changes.find((c) => c.field === "generated")).toBeUndefined()
    expect(result.applied).toBe(false)
  })
})

describe("run-marketing-ideas-email — buildIdeasEmailSendExistingResult", () => {
  it("dry-run, sendable: would-send, not applied", () => {
    const result = buildIdeasEmailSendExistingResult(
      "jid",
      true,
      "log_1",
      { guard_passed: true, sent: false },
      0
    )
    expect(result.applied).toBe(false)
    const sentChange = result.changes.find((c) => c.field === "sent")
    expect(sentChange?.after).toBe("(would send)")
    expect(result.summary).toMatch(/would send/)
  })

  it("apply, sendable: sent, applied, summary mentions count", () => {
    const result = buildIdeasEmailSendExistingResult(
      "jid",
      false,
      "log_1",
      { guard_passed: true, sent: false },
      3
    )
    expect(result.applied).toBe(true)
    const sentChange = result.changes.find((c) => c.field === "sent")
    expect(sentChange?.after).toBe(true)
    expect(result.summary).toMatch(/Sent/)
    expect(result.summary).toMatch(/3/)
  })

  it("not sendable (guard failed): empty changes, not applied", () => {
    const result = buildIdeasEmailSendExistingResult(
      "jid",
      false,
      "log_9",
      { guard_passed: false, sent: false },
      0
    )
    expect(result.changes).toEqual([])
    expect(result.applied).toBe(false)
  })

  it("not sendable (already sent): empty changes, not applied", () => {
    const result = buildIdeasEmailSendExistingResult(
      "jid",
      false,
      "log_9",
      { guard_passed: true, sent: true },
      0
    )
    expect(result.changes).toEqual([])
    expect(result.applied).toBe(false)
  })
})
