import {
  shouldRequestPostDeliveryFeedback,
  selectExistingFeedbackRequest,
  resolveFeedbackStoreBase,
  buildFeedbackUrl,
  buildPostDeliveryFeedbackEmailData,
} from "../post-delivery-feedback"

describe("post-delivery-feedback pure helpers (#452)", () => {
  describe("shouldRequestPostDeliveryFeedback", () => {
    it("requests by default", () => {
      expect(shouldRequestPostDeliveryFeedback({})).toEqual({ request: true })
    })

    it("skips on event no_notification flag", () => {
      const r = shouldRequestPostDeliveryFeedback({ eventNoNotification: true })
      expect(r.request).toBe(false)
      expect(r.reason).toMatch(/event/)
    })

    it("skips on order metadata.no_notification", () => {
      const r = shouldRequestPostDeliveryFeedback({
        order: { metadata: { no_notification: true } },
      })
      expect(r.request).toBe(false)
      expect(r.reason).toMatch(/metadata/)
    })

    it("does NOT skip merely because the order has no email", () => {
      expect(
        shouldRequestPostDeliveryFeedback({ order: { metadata: {} } }).request
      ).toBe(true)
    })
  })

  describe("selectExistingFeedbackRequest (idempotency)", () => {
    it("returns null for empty / nullish input", () => {
      expect(selectExistingFeedbackRequest(null)).toBeNull()
      expect(selectExistingFeedbackRequest(undefined)).toBeNull()
      expect(selectExistingFeedbackRequest([])).toBeNull()
    })

    it("returns the first live row", () => {
      const r = selectExistingFeedbackRequest([
        { id: "fb_1", order_id: "o1" },
        { id: "fb_2", order_id: "o1" },
      ])
      expect(r?.id).toBe("fb_1")
    })

    it("ignores soft-deleted rows", () => {
      const r = selectExistingFeedbackRequest([
        { id: "fb_1", order_id: "o1", deleted_at: new Date() },
        { id: "fb_2", order_id: "o1" },
      ])
      expect(r?.id).toBe("fb_2")
    })

    it("returns null when all rows are soft-deleted", () => {
      const r = selectExistingFeedbackRequest([
        { id: "fb_1", order_id: "o1", deleted_at: "2020-01-01" },
      ])
      expect(r).toBeNull()
    })
  })

  describe("resolveFeedbackStoreBase", () => {
    it("prefers explicit override", () => {
      expect(
        resolveFeedbackStoreBase({ STORE_URL: "https://s.com" }, "https://o.com/")
      ).toBe("https://o.com")
    })

    it("falls back STORE_URL → FRONTEND_URL → ''", () => {
      expect(resolveFeedbackStoreBase({ STORE_URL: "https://s.com/" })).toBe(
        "https://s.com"
      )
      expect(resolveFeedbackStoreBase({ FRONTEND_URL: "https://f.com" })).toBe(
        "https://f.com"
      )
      expect(resolveFeedbackStoreBase({})).toBe("")
    })

    it("trims trailing slashes", () => {
      expect(resolveFeedbackStoreBase({ STORE_URL: "https://s.com///" })).toBe(
        "https://s.com"
      )
    })
  })

  describe("buildFeedbackUrl", () => {
    it("composes a /feedback/:id url", () => {
      expect(buildFeedbackUrl("https://s.com", "fb_1")).toBe(
        "https://s.com/feedback/fb_1"
      )
    })

    it("returns '' without a base or id", () => {
      expect(buildFeedbackUrl("", "fb_1")).toBe("")
      expect(buildFeedbackUrl("https://s.com", "")).toBe("")
    })
  })

  describe("buildPostDeliveryFeedbackEmailData", () => {
    const now = new Date("2026-06-22T00:00:00Z")

    it("assembles the order-feedback-request template data", () => {
      const out = buildPostDeliveryFeedbackEmailData({
        order: { id: "order_1", display_id: 1042, email: "c@x.com" },
        customerName: "Asha",
        feedbackId: "fb_9",
        storeBase: "https://s.com",
        now,
      })
      expect(out.to).toBe("c@x.com")
      expect(out.template).toBe("order-feedback-request")
      expect(out.data).toMatchObject({
        customer_name: "Asha",
        order_id: "order_1",
        order_display: "#1042",
        feedback_url: "https://s.com/feedback/fb_9",
        store_url: "https://s.com",
        current_year: 2026,
        feedback_id: "fb_9",
      })
    })

    it("falls back to order id when display_id missing and to 'there' for blank name", () => {
      const out = buildPostDeliveryFeedbackEmailData({
        order: { id: "order_2", email: "" },
        customerName: "  ",
        feedbackId: "fb_2",
        storeBase: "",
        now,
      })
      expect(out.to).toBe("")
      expect(out.data.order_display).toBe("order_2")
      expect(out.data.customer_name).toBe("there")
      expect(out.data.feedback_url).toBe("")
    })
  })
})
