/**
 * #1339 — the suppression policy table, both policies.
 *
 * The stakes are asymmetric: wrongly suppressing is worse than wrongly sending,
 * because a dropped order confirmation is invisible to everyone. So the
 * "still sends" cases are asserted as carefully as the blocking ones.
 */
import {
  classifySuppression,
  resolveSuppressionMode,
  shouldAlertOnSuppression,
  suppressionLog,
  partnerComplaintAlertLog,
  DEFAULT_SUPPRESSION_MODE,
  EMAIL_SUPPRESSED_SEND_ID,
  type SuppressionReason,
} from "../email-suppression-policy"

const blocked = (
  reasons: SuppressionReason[],
  channel: string,
  mode?: "strict" | "partner-carve-out"
) => classifySuppression(reasons, channel, mode ?? DEFAULT_SUPPRESSION_MODE).suppress

describe("email suppression policy", () => {
  describe("hard_bounce — the mailbox does not exist", () => {
    it("blocks every channel under both policies", () => {
      for (const mode of ["partner-carve-out", "strict"] as const) {
        expect(blocked(["hard_bounce"], "email", mode)).toBe(true)
        expect(blocked(["hard_bounce"], "email_bulk", mode)).toBe(true)
        expect(blocked(["hard_bounce"], "email_partner", mode)).toBe(true)
      }
    })
  })

  describe("spam_complaint — where the two policies differ", () => {
    it("blocks marketing and lifecycle under both", () => {
      for (const mode of ["partner-carve-out", "strict"] as const) {
        expect(blocked(["spam_complaint"], "email", mode)).toBe(true)
        expect(blocked(["spam_complaint"], "email_bulk", mode)).toBe(true)
      }
    })

    it("lets partner operational mail through under the carve-out", () => {
      expect(blocked(["spam_complaint"], "email_partner", "partner-carve-out")).toBe(false)
    })

    it("blocks partner operational mail under strict", () => {
      expect(blocked(["spam_complaint"], "email_partner", "strict")).toBe(true)
    })

    it("raises an alert on partner mail regardless of policy", () => {
      expect(shouldAlertOnSuppression(["spam_complaint"], "email_partner")).toBe(true)
      expect(shouldAlertOnSuppression(["spam_complaint"], "email")).toBe(false)
      expect(shouldAlertOnSuppression(["hard_bounce"], "email_partner")).toBe(false)
    })
  })

  describe("unsubscribe — consent for marketing, not for the order they paid for", () => {
    it("blocks bulk only", () => {
      for (const mode of ["partner-carve-out", "strict"] as const) {
        expect(blocked(["unsubscribe"], "email_bulk", mode)).toBe(true)
        expect(blocked(["unsubscribe"], "email", mode)).toBe(false)
        expect(blocked(["unsubscribe"], "email_partner", mode)).toBe(false)
      }
    })
  })

  describe("soft_bounce — a decision, not an accident", () => {
    it("blocks nothing: a full mailbox is a live human", () => {
      for (const mode of ["partner-carve-out", "strict"] as const) {
        expect(blocked(["soft_bounce"], "email", mode)).toBe(false)
        expect(blocked(["soft_bounce"], "email_bulk", mode)).toBe(false)
        expect(blocked(["soft_bounce"], "email_partner", mode)).toBe(false)
      }
    })
  })

  describe("manual — someone did this on purpose", () => {
    it("blocks every channel", () => {
      expect(blocked(["manual"], "email")).toBe(true)
      expect(blocked(["manual"], "email_bulk")).toBe(true)
      expect(blocked(["manual"], "email_partner")).toBe(true)
    })
  })

  describe("multiple rows on one address", () => {
    it("the strictest rule wins — a later unsubscribe cannot downgrade a hard bounce", () => {
      expect(blocked(["unsubscribe", "hard_bounce"], "email")).toBe(true)
      expect(blocked(["hard_bounce", "unsubscribe"], "email")).toBe(true)
    })

    it("an address with no rows is never suppressed", () => {
      expect(blocked([], "email")).toBe(false)
      expect(blocked([], "email_bulk")).toBe(false)
      expect(blocked([], "email_partner")).toBe(false)
    })
  })

  describe("non-email channels are none of this module's business", () => {
    it("never suppresses whatsapp or feed, whatever is on file", () => {
      expect(blocked(["hard_bounce", "manual"], "whatsapp")).toBe(false)
      expect(blocked(["hard_bounce", "manual"], "feed")).toBe(false)
      expect(blocked(["hard_bounce", "manual"], "sms")).toBe(false)
    })
  })

  describe("mode resolution fails safe", () => {
    it("defaults to the carve-out and only 'strict' switches it", () => {
      expect(resolveSuppressionMode(undefined)).toBe("partner-carve-out")
      expect(resolveSuppressionMode("")).toBe("partner-carve-out")
      expect(resolveSuppressionMode("STRICT")).toBe("strict")
      expect(resolveSuppressionMode(" strict ")).toBe("strict")
      // A typo must not take email down, and must not silently harden either.
      expect(resolveSuppressionMode("strictt")).toBe("partner-carve-out")
      expect(resolveSuppressionMode("true")).toBe("partner-carve-out")
    })
  })

  describe("a suppression is never silent", () => {
    it("logs the address, template, channel, reason and policy", () => {
      const verdict = classifySuppression(["hard_bounce"], "email", "strict")
      const line = suppressionLog("resend", " Foo@Example.COM ", "order-shipment-delivered", "email", verdict)
      expect(line).toContain("[email-suppressed]")
      expect(line).toContain("provider=resend")
      expect(line).toContain("to=foo@example.com")
      expect(line).toContain("template=order-shipment-delivered")
      expect(line).toContain("channel=email")
      expect(line).toContain("reason=hard_bounce")
      expect(line).toContain("policy=strict")
    })

    it("names the partner complaint that was deliberately delivered", () => {
      const line = partnerComplaintAlertLog("maileroo", "p@partner.test", "partner-quote-issued")
      expect(line).toContain("[partner-spam-complaint]")
      expect(line).toContain("to=p@partner.test")
    })

    it("suppressed never reads as sent", () => {
      expect(EMAIL_SUPPRESSED_SEND_ID).toContain("suppressed")
    })
  })
})
