import { parseEmails, bounceMetadata } from "../suppress-bounced-subscribers-job"

describe("suppress-bounced-subscribers — parseEmails", () => {
  it("splits on comma, newline, space, semicolon and tab", () => {
    const raw = "a@x.com, b@y.com\nc@z.com d@w.com;e@v.com\tf@u.com"
    expect(parseEmails(raw).sort()).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
      "d@w.com",
      "e@v.com",
      "f@u.com",
    ].sort())
  })

  it("lowercases and de-duplicates", () => {
    expect(parseEmails("Foo@Gmail.com, foo@gmail.com FOO@GMAIL.COM")).toEqual([
      "foo@gmail.com",
    ])
  })

  it("drops invalid tokens", () => {
    expect(parseEmails("notanemail, @nope.com, good@ok.com, x@y")).toEqual([
      "good@ok.com",
    ])
  })

  it("returns [] for empty/garbage input", () => {
    expect(parseEmails("")).toEqual([])
    expect(parseEmails("   ,;\n\t ")).toEqual([])
  })
})

describe("suppress-bounced-subscribers — bounceMetadata", () => {
  const opts = { reason: "hard_bounce", source: "csv_import", at: "2026-07-03T00:00:00.000Z" }

  it("stamps bounce fields while preserving existing metadata", () => {
    // `bounce_source` is a distinct key — the existing `source` is left intact.
    expect(bounceMetadata({ source: "web_form", note: "keep" }, opts)).toEqual({
      source: "web_form",
      note: "keep",
      bounced: true,
      bounced_at: opts.at,
      bounce_reason: "hard_bounce",
      bounce_source: "csv_import",
    })
  })

  it("is idempotent — returns null when already bounced", () => {
    expect(bounceMetadata({ bounced: true, bounce_reason: "hard_bounce" }, opts)).toBeNull()
  })

  it("handles null/undefined existing metadata", () => {
    expect(bounceMetadata(null, opts)).toEqual({
      bounced: true,
      bounced_at: opts.at,
      bounce_reason: "hard_bounce",
      bounce_source: "csv_import",
    })
    expect(bounceMetadata(undefined, opts)?.bounced).toBe(true)
  })
})
