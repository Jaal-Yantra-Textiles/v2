import {
  buildDailySummaryResult,
  sendMarketingDailySummaryJob,
} from "../registry"
import type { DailySummary } from "../../../marketing/marketing-summary-lib"

/**
 * #659 §12.6 — unit tests for the WhatsApp daily-summary job's pure result
 * builder + the job descriptor. No WhatsApp / DB.
 */

const summary = (over: Partial<DailySummary> = {}): DailySummary => ({
  text: "📊 JYT Marketing — 2026-06-23\n\n🎯 Platform Net Gmv: ₹1,23,456",
  hasData: true,
  stale: false,
  ...over,
})

describe("buildDailySummaryResult", () => {
  it("dry-run with recipients: previews and does not apply", () => {
    const r = buildDailySummaryResult({
      jobId: "job",
      dry_run: true,
      summary: summary(),
      recipients: ["+910000000001", "+910000000002"],
      sent: 0,
      errors: [],
    })
    expect(r.applied).toBe(false)
    expect(r.summary).toContain("Dry-run")
    expect(r.summary).toContain("--- preview ---")
    expect(r.changes).toHaveLength(2)
    expect(r.changes[0].after).toBe("(would send)")
  })

  it("apply: reports sent count and is applied", () => {
    const r = buildDailySummaryResult({
      jobId: "job",
      dry_run: false,
      summary: summary(),
      recipients: ["+910000000001"],
      sent: 1,
      errors: [],
    })
    expect(r.applied).toBe(true)
    expect(r.summary).toContain("Sent the daily marketing summary to 1/1")
    expect(r.changes[0].after).toBe("sent")
  })

  it("apply with a send error surfaces errors[] and partial count", () => {
    const r = buildDailySummaryResult({
      jobId: "job",
      dry_run: false,
      summary: summary(),
      recipients: ["+a", "+b"],
      sent: 1,
      errors: [{ id: "+b", message: "bad number" }],
    })
    expect(r.applied).toBe(true)
    expect(r.summary).toContain("1/2")
    expect(r.summary).toContain("1 failed")
    expect(r.errors).toEqual([{ id: "+b", message: "bad number" }])
  })

  it("no recipients: composed but nothing sent, not applied", () => {
    const r = buildDailySummaryResult({
      jobId: "job",
      dry_run: false,
      summary: summary(),
      recipients: [],
      sent: 0,
      errors: [],
    })
    expect(r.applied).toBe(false)
    expect(r.summary).toContain("no WhatsApp recipients are configured")
  })

  it("no data: nothing to send regardless of recipients", () => {
    const r = buildDailySummaryResult({
      jobId: "job",
      dry_run: false,
      summary: summary({ hasData: false }),
      recipients: ["+a"],
      sent: 0,
      errors: [],
    })
    expect(r.applied).toBe(false)
    expect(r.summary).toContain("No marketing snapshots captured yet")
  })
})

describe("sendMarketingDailySummaryJob", () => {
  it("is a well-formed maintenance job", () => {
    expect(sendMarketingDailySummaryJob.id).toBe("send-marketing-daily-summary")
    expect(sendMarketingDailySummaryJob.params.map((p) => p.name)).toEqual(["to"])
    expect(sendMarketingDailySummaryJob.params.every((p) => !p.required)).toBe(
      true
    )
  })
})
