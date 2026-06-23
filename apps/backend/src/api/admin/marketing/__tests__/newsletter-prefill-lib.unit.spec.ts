import { buildNewsletterPrefill } from "../newsletter-prefill-lib"

describe("buildNewsletterPrefill", () => {
  it("handles null/undefined/empty payload", () => {
    expect(buildNewsletterPrefill(null)).toEqual({ title: "", content: "" })
    expect(buildNewsletterPrefill(undefined)).toEqual({ title: "", content: "" })
    expect(buildNewsletterPrefill({})).toEqual({ title: "", content: "" })
  })

  it("trims and maps subject to title", () => {
    expect(buildNewsletterPrefill({ subject: "  Weekly Update  " }).title).toBe(
      "Weekly Update"
    )
    expect(
      buildNewsletterPrefill({ subject: "  Weekly Update  " }).content
    ).toBe("")
  })

  it("builds full content with intro and sections", () => {
    expect(
      buildNewsletterPrefill({
        subject: "S",
        intro: "Welcome back.",
        sections: [
          { heading: "New Arrivals", body: "Fresh stock." },
          { heading: "Sale", body: "20% off." },
        ],
      })
    ).toEqual({
      title: "S",
      content:
        "Welcome back.\n\n## New Arrivals\n\nFresh stock.\n\n## Sale\n\n20% off.",
    })
  })

  it("handles section with only heading", () => {
    expect(
      buildNewsletterPrefill({
        subject: "S",
        sections: [{ heading: "Just A Heading" }],
      }).content
    ).toBe("## Just A Heading")
  })

  it("handles section with only body", () => {
    expect(
      buildNewsletterPrefill({
        subject: "S",
        sections: [{ body: "Just a body" }],
      }).content
    ).toBe("Just a body")
  })

  it("skips section when both heading and body are empty/whitespace", () => {
    expect(
      buildNewsletterPrefill({
        subject: "S",
        intro: "I",
        sections: [{ heading: "  ", body: "" }],
      }).content
    ).toBe("I")
  })

  it("coerces non-string subject to empty title", () => {
    expect(
      buildNewsletterPrefill({ subject: 123 as unknown as string }).title
    ).toBe("")
  })
})
