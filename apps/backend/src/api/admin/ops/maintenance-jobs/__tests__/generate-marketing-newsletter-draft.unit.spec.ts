import {
  buildNewsletterDraftResult,
  generateMarketingNewsletterDraftJob,
} from "../registry"
import type { GenerateNewsletterDraftResult } from "../../../../../workflows/marketing/generate-newsletter-draft"

/**
 * #659 §12.4 — unit tests for the newsletter-draft maintenance job's pure result
 * builder. No DB / LLM: we feed a fabricated generate result and assert the
 * dry-run vs apply reporting + parse-error wording + the `applied` flag.
 */

const baseResult = (
  over: Partial<GenerateNewsletterDraftResult> = {}
): GenerateNewsletterDraftResult => ({
  generated: true,
  draft_id: "draft_1",
  name: "newsletter-2026-06-23",
  status: "draft",
  model_used: "stub",
  payload: {
    subject: "Subject",
    preheader: "Pre",
    intro: "Intro",
    sections: [{ heading: "H", body: "B" }],
    cta: "Shop",
  },
  parse_error: false,
  ...over,
})

describe("buildNewsletterDraftResult", () => {
  it("dry-run: reports a draft for review and is NOT applied", () => {
    const r = buildNewsletterDraftResult("job", true, baseResult())
    expect(r.dry_run).toBe(true)
    expect(r.applied).toBe(false)
    expect(r.summary).toContain("status=draft")
    expect(r.summary.toLowerCase()).toContain("dry-run")
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0].entity).toBe("marketing_draft")
    expect(r.changes[0].id).toBe("draft_1")
    expect((r.changes[0].after as any).sections).toBe(1)
  })

  it("apply: an approved draft is reported as applied", () => {
    const r = buildNewsletterDraftResult(
      "job",
      false,
      baseResult({ status: "approved" })
    )
    expect(r.applied).toBe(true)
    expect(r.summary).toContain("status=approved")
  })

  it("apply with no draft_id is not applied", () => {
    const r = buildNewsletterDraftResult(
      "job",
      false,
      baseResult({ status: "approved", draft_id: null })
    )
    expect(r.applied).toBe(false)
    expect(r.changes[0].id).toBe("(none)")
  })

  it("surfaces a parse_error note in the summary", () => {
    const r = buildNewsletterDraftResult(
      "job",
      true,
      baseResult({ parse_error: true })
    )
    expect(r.summary).toContain("not valid JSON")
    expect((r.changes[0].after as any).parse_error).toBe(true)
  })
})

describe("generateMarketingNewsletterDraftJob", () => {
  it("is a well-formed, registered maintenance job", () => {
    expect(generateMarketingNewsletterDraftJob.id).toBe(
      "generate-marketing-newsletter-draft"
    )
    expect(generateMarketingNewsletterDraftJob.params.map((p) => p.name)).toEqual(
      ["topic", "name"]
    )
    expect(
      generateMarketingNewsletterDraftJob.params.every((p) => !p.required)
    ).toBe(true)
  })
})
