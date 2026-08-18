import {
  classifyRecipient,
  isBotRecipient,
  normalizeRecipient,
  partitionBotRecipients,
  botSuppressionLog,
  SUPPRESSED_RECIPIENT_DOMAINS,
} from "../bot-recipients"

describe("bot recipient policy (#1333)", () => {
  describe("the address that actually got mailed on prod", () => {
    // The ONLY cart-abandoned recipient in the last 200 prod notifications.
    const REAL = "johnsmith004@storebotmail.joonix.net"

    it("is classified as a bot", () => {
      expect(isBotRecipient(REAL)).toBe(true)
      expect(classifyRecipient(REAL)).toEqual({
        bot: true,
        rule: "joonix.net",
        note: "Google shopping crawler (storebot) infrastructure",
      })
    })

    it("is still a bot with different casing or padding", () => {
      expect(isBotRecipient("  JohnSmith004@StoreBotMail.Joonix.NET ")).toBe(true)
    })

    it("is still a bot inside a display-name form", () => {
      expect(isBotRecipient("John Smith <johnsmith004@storebotmail.joonix.net>")).toBe(true)
    })
  })

  describe("matching is on a dot boundary, never a substring", () => {
    it("catches the apex and any subdomain", () => {
      expect(isBotRecipient("a@joonix.net")).toBe(true)
      expect(isBotRecipient("a@deep.nested.joonix.net")).toBe(true)
    })

    it("does NOT catch a lookalike domain", () => {
      // The failure that matters: suppressing a real customer silently.
      expect(isBotRecipient("a@notjoonix.net")).toBe(false)
      expect(isBotRecipient("a@joonix.net.example.com")).toBe(false)
      expect(isBotRecipient("a@myjoonix.net")).toBe(false)
    })
  })

  describe("real customers are never suppressed", () => {
    const HUMANS = [
      "customer@gmail.com",
      "someone@jaalyantra.com",
      "robot.fan@yahoo.co.in",       // 'robot' in the local part is not a rule
      "storebot@gmail.com",          // 'storebot' at a human domain is not a rule
      "a@joonix.com",                // different TLD
    ]
    for (const email of HUMANS) {
      it(email, () => expect(isBotRecipient(email)).toBe(false))
    }
  })

  describe("garbage in", () => {
    for (const bad of [null, undefined, "", "   ", "not-an-email", "@", "no-domain@"]) {
      it(`${JSON.stringify(bad)} is not a bot (and does not throw)`, () => {
        expect(isBotRecipient(bad as any)).toBe(false)
      })
    }
  })

  describe("normalizeRecipient", () => {
    it("unwraps a display name", () => {
      expect(normalizeRecipient("Jane Doe <JANE@Example.com>")).toBe("jane@example.com")
    })
    it("passes a bare address through lowercased", () => {
      expect(normalizeRecipient(" Bare@Example.COM ")).toBe("bare@example.com")
    })
  })

  describe("partitionBotRecipients (bulk paths get the same policy)", () => {
    it("splits a batch and keeps order", () => {
      const entries = [
        { to: "a@gmail.com" },
        { to: "bot@storebotmail.joonix.net" },
        { to: "b@gmail.com" },
      ]
      const { send, suppressed } = partitionBotRecipients(entries, (e) => e.to)
      expect(send.map((e) => e.to)).toEqual(["a@gmail.com", "b@gmail.com"])
      expect(suppressed).toHaveLength(1)
      expect(suppressed[0].entry.to).toBe("bot@storebotmail.joonix.net")
      expect(suppressed[0].verdict.rule).toBe("joonix.net")
    })

    it("an all-human batch is untouched", () => {
      const entries = [{ to: "a@gmail.com" }, { to: "b@gmail.com" }]
      const { send, suppressed } = partitionBotRecipients(entries, (e) => e.to)
      expect(send).toHaveLength(2)
      expect(suppressed).toHaveLength(0)
    })

    it("an all-bot batch sends nothing", () => {
      const entries = [{ to: "x@joonix.net" }, { to: "y@storebotmail.joonix.net" }]
      const { send, suppressed } = partitionBotRecipients(entries, (e) => e.to)
      expect(send).toHaveLength(0)
      expect(suppressed).toHaveLength(2)
    })
  })

  describe("suppression is visible", () => {
    it("the log line names the address, template, rule and reason", () => {
      const line = botSuppressionLog(
        "resend",
        "JohnSmith004@storebotmail.joonix.net",
        "cart-abandoned",
        classifyRecipient("johnsmith004@storebotmail.joonix.net")
      )
      expect(line).toContain("[bot-recipient-suppressed]")
      expect(line).toContain("provider=resend")
      expect(line).toContain("to=johnsmith004@storebotmail.joonix.net")
      expect(line).toContain("template=cart-abandoned")
      expect(line).toContain("rule=joonix.net")
      expect(line).toContain("Google shopping crawler")
    })

    it("tolerates a missing template", () => {
      expect(
        botSuppressionLog("mailjet", "a@joonix.net", undefined, classifyRecipient("a@joonix.net"))
      ).toContain("template=-")
    })
  })

  describe("the rule list itself", () => {
    it("is explicit — every rule carries a reason someone can audit", () => {
      expect(SUPPRESSED_RECIPIENT_DOMAINS.length).toBeGreaterThan(0)
      for (const r of SUPPRESSED_RECIPIENT_DOMAINS) {
        expect(r.suffix).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
        expect(r.note.length).toBeGreaterThan(10)
      }
    })

    it("contains no bare TLD or wildcard that could swallow real mail", () => {
      for (const r of SUPPRESSED_RECIPIENT_DOMAINS) {
        expect(r.suffix).not.toMatch(/[*]/)
        expect(r.suffix.split(".").length).toBeGreaterThanOrEqual(2)
      }
    })
  })
})
