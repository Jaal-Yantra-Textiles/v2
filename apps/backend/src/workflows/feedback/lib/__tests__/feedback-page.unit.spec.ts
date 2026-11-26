import {
  FEEDBACK_COMMENT_MAX,
  buildPublicFeedbackView,
  isBuyerFeedbackRequest,
  parseFeedbackSubmission,
} from "../feedback-page"
import { buildFeedbackUrl } from "../post-delivery-feedback"

describe("feedback page helpers", () => {
  describe("isBuyerFeedbackRequest", () => {
    it("only a row tied to an order is a buyer's page", () => {
      expect(isBuyerFeedbackRequest({ id: "fb_1", order_id: "order_1" })).toBe(true)
      // partner/task/admin feedback shares the table — never public
      expect(isBuyerFeedbackRequest({ id: "fb_2", order_id: null })).toBe(false)
      expect(isBuyerFeedbackRequest({ id: "fb_3", order_id: "  " })).toBe(false)
      expect(isBuyerFeedbackRequest(null)).toBe(false)
    })
  })

  describe("buildPublicFeedbackView", () => {
    const order = {
      display_id: 42,
      items: [
        {
          title: "Default variant",
          product_title: "Indigo stole",
          variant_title: "Default variant",
          thumbnail: "https://cdn/x.jpg",
          quantity: 2,
        },
        { title: "Kurta", variant_title: "M", thumbnail: null, quantity: "1" },
      ],
    }

    it("hides the default rating until the buyer answers", () => {
      const v = buildPublicFeedbackView({
        feedback: { id: "fb_1", order_id: "o", rating: "three", comment: null, answered_at: null },
        order,
        store: { name: null, url: "https://cicilabel.com" },
      })
      expect(v.feedback.answered).toBe(false)
      expect(v.feedback.rating).toBeNull()
      expect(v.order?.display_id).toBe(42)
      expect(v.order?.items).toEqual([
        { title: "Indigo stole", variant_title: null, thumbnail: "https://cdn/x.jpg", quantity: 2 },
        { title: "Kurta", variant_title: "M", thumbnail: null, quantity: 1 },
      ])
      expect(v.store.url).toBe("https://cicilabel.com")
    })

    it("returns the buyer's own answer once answered", () => {
      const v = buildPublicFeedbackView({
        feedback: {
          id: "fb_1",
          order_id: "o",
          rating: "five",
          comment: "Lovely",
          answered_at: "2026-11-26T10:00:00.000Z",
        },
      })
      expect(v.feedback.answered).toBe(true)
      expect(v.feedback.rating).toBe("five")
      expect(v.feedback.comment).toBe("Lovely")
      expect(v.feedback.answered_at).toBe("2026-11-26T10:00:00.000Z")
      expect(v.order).toBeNull()
    })

    it("never carries buyer contact details, even if the order row has them", () => {
      const v = buildPublicFeedbackView({
        feedback: { id: "fb_1", order_id: "o" },
        order: { ...order, email: "a@b.com", shipping_address: { phone: "99" } } as any,
      })
      const json = JSON.stringify(v)
      expect(json).not.toContain("a@b.com")
      expect(json).not.toContain("phone")
    })
  })

  describe("parseFeedbackSubmission", () => {
    it("requires a 1..5 rating", () => {
      expect(parseFeedbackSubmission({}).ok).toBe(false)
      expect(parseFeedbackSubmission({ rating: 0 }).ok).toBe(false)
      expect(parseFeedbackSubmission({ rating: 6 }).ok).toBe(false)
      expect(parseFeedbackSubmission(null).ok).toBe(false)
      expect(parseFeedbackSubmission({ rating: 4 })).toEqual({ ok: true, rating: "four", comment: null })
      expect(parseFeedbackSubmission({ rating: "five", comment: "  great  " })).toEqual({
        ok: true,
        rating: "five",
        comment: "great",
      })
    })

    it("rejects a non-text or oversized comment", () => {
      expect(parseFeedbackSubmission({ rating: 3, comment: 5 }).ok).toBe(false)
      expect(
        parseFeedbackSubmission({ rating: 3, comment: "x".repeat(FEEDBACK_COMMENT_MAX + 1) }).ok
      ).toBe(false)
    })
  })

  describe("the email link shape the storefront page serves", () => {
    it("is <shop>/feedback/<id>, no country — the storefront middleware adds it", () => {
      expect(buildFeedbackUrl("https://hrhandloom.in/", "feedback_01ABC")).toBe(
        "https://hrhandloom.in/feedback/feedback_01ABC"
      )
    })
  })
})
