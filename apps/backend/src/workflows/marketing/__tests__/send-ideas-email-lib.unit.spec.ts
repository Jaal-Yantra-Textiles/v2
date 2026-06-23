import {
  buildIdeasEmailTemplateData,
  escapeHtml,
  isLogSendable,
  parseRecipientsCsv,
  resolveIdeasRecipients,
} from "../send-ideas-email-lib"

describe("send-ideas-email-lib", () => {
  describe("isLogSendable", () => {
    it("is true only when guard passed AND there's copy", () => {
      expect(
        isLogSendable({ id: "1", guard_passed: true, output_text: "Do X." })
      ).toBe(true)
    })
    it("is false on guard failure even with copy (fail closed)", () => {
      expect(
        isLogSendable({ id: "1", guard_passed: false, output_text: "Do X." })
      ).toBe(false)
    })
    it("is false on empty/whitespace copy", () => {
      expect(
        isLogSendable({ id: "1", guard_passed: true, output_text: "   " })
      ).toBe(false)
      expect(
        isLogSendable({ id: "1", guard_passed: true, output_text: null })
      ).toBe(false)
    })
    it("is false for null/undefined log", () => {
      expect(isLogSendable(null)).toBe(false)
      expect(isLogSendable(undefined)).toBe(false)
    })
  })

  describe("parseRecipientsCsv", () => {
    it("splits, trims, lower-cases and dedupes", () => {
      expect(
        parseRecipientsCsv("A@x.com, b@x.com\n A@X.COM ;c@x.com")
      ).toEqual(["a@x.com", "b@x.com", "c@x.com"])
    })
    it("drops malformed entries", () => {
      expect(parseRecipientsCsv("good@x.com, not-an-email, @x.com")).toEqual([
        "good@x.com",
      ])
    })
    it("returns [] for empty/nullish", () => {
      expect(parseRecipientsCsv("")).toEqual([])
      expect(parseRecipientsCsv(null)).toEqual([])
      expect(parseRecipientsCsv(undefined)).toEqual([])
    })
  })

  describe("resolveIdeasRecipients", () => {
    it("prefers explicit over csv over admins", () => {
      expect(
        resolveIdeasRecipients({
          explicit: ["E@x.com"],
          csv: "c@x.com",
          adminEmails: ["a@x.com"],
        })
      ).toEqual(["e@x.com"])
    })
    it("falls back to csv when no explicit", () => {
      expect(
        resolveIdeasRecipients({
          explicit: [],
          csv: "c@x.com, d@x.com",
          adminEmails: ["a@x.com"],
        })
      ).toEqual(["c@x.com", "d@x.com"])
    })
    it("falls back to admin emails when no explicit/csv", () => {
      expect(
        resolveIdeasRecipients({
          csv: "",
          adminEmails: ["A@x.com", "a@x.com", "bad"],
        })
      ).toEqual(["a@x.com"])
    })
    it("returns [] when every source is empty", () => {
      expect(resolveIdeasRecipients({})).toEqual([])
    })
    it("ignores malformed explicit entries", () => {
      expect(
        resolveIdeasRecipients({ explicit: ["nope", "ok@x.com"] })
      ).toEqual(["ok@x.com"])
    })
  })

  describe("escapeHtml", () => {
    it("escapes the dangerous five", () => {
      expect(escapeHtml(`<a href="x">&'`)).toBe(
        "&lt;a href=&quot;x&quot;&gt;&amp;&#39;"
      )
    })
  })

  describe("buildIdeasEmailTemplateData", () => {
    it("escapes copy and turns newlines into <br>", () => {
      const data = buildIdeasEmailTemplateData({
        log: {
          id: "1",
          output_text: "Lift ₹1,84,320.\n<b>Push</b> carts.",
          model_used: "anthropic/claude-3.5-sonnet",
          generated_for_date: new Date("2031-03-01T00:00:00.000Z"),
        },
        oneGoal: "Grow GMV.",
        dashboardUrl: "https://admin/x",
        now: new Date("2031-03-01T00:00:00.000Z"),
      })
      expect(data.ideas_html).toBe(
        "Lift ₹1,84,320.<br>&lt;b&gt;Push&lt;/b&gt; carts."
      )
      expect(data.ideas_text).toBe("Lift ₹1,84,320.\n<b>Push</b> carts.")
      expect(data.generated_date).toBe("2031-03-01")
      expect(data.one_goal).toBe("Grow GMV.")
      expect(data.dashboard_url).toBe("https://admin/x")
      expect(data.model_used).toBe("anthropic/claude-3.5-sonnet")
      expect(data.current_year).toBe("2031")
    })
    it("tolerates missing optional fields", () => {
      const data = buildIdeasEmailTemplateData({
        log: { id: "1", output_text: "x" },
        now: new Date("2026-06-23T00:00:00.000Z"),
      })
      expect(data.one_goal).toBe("")
      expect(data.dashboard_url).toBe("")
      expect(data.model_used).toBe("")
      expect(data.generated_date).toBe("")
      expect(data.current_year).toBe("2026")
    })
    it("accepts a string date and slices to YYYY-MM-DD", () => {
      const data = buildIdeasEmailTemplateData({
        log: {
          id: "1",
          output_text: "x",
          generated_for_date: "2031-12-25T11:22:33.000Z",
        },
      })
      expect(data.generated_date).toBe("2031-12-25")
    })
  })
})
