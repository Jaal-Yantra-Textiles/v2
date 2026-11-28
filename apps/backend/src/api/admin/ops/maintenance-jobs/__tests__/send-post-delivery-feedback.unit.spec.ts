import {
  parseOrderIds,
  pickDeliveredFulfillment,
  planFeedbackSend,
} from "../send-post-delivery-feedback-lib"

describe("send-post-delivery-feedback planning", () => {
  it("parses a comma list, trimming blanks and duplicates", () => {
    expect(parseOrderIds(" order_a, order_b,,order_a ")).toEqual(["order_a", "order_b"])
    expect(parseOrderIds(undefined)).toEqual([])
  })

  it("picks the latest delivered fulfillment and ignores cancelled/undelivered ones", () => {
    const f = pickDeliveredFulfillment([
      { id: "ful_old", delivered_at: "2026-08-04T00:00:00Z" },
      { id: "ful_cancel", delivered_at: "2026-10-01T00:00:00Z", canceled_at: "2026-10-02T00:00:00Z" },
      { id: "ful_new", delivered_at: "2026-09-28T00:00:00Z" },
      { id: "ful_open", delivered_at: null },
    ])
    expect(f?.id).toBe("ful_new")
    expect(pickDeliveredFulfillment([{ id: "x", delivered_at: null }])).toBeNull()
  })

  const delivered = {
    id: "order_1",
    display_id: 3,
    email: " buyer@example.com ",
    fulfillments: [{ id: "ful_1", delivered_at: "2026-09-28T00:00:00Z" }],
  }

  it("reuses an existing unanswered feedback link", () => {
    expect(planFeedbackSend(delivered, [{ id: "fb_1", status: "pending", answered_at: null }])).toEqual({
      action: "send",
      order_id: "order_1",
      fulfillment_id: "ful_1",
      to: "buyer@example.com",
      existing_feedback_id: "fb_1",
    })
  })

  it("sends with a new request when none exists, ignoring soft-deleted rows", () => {
    const plan = planFeedbackSend(delivered, [{ id: "fb_gone", deleted_at: "2026-01-01" }])
    expect(plan).toMatchObject({ action: "send", existing_feedback_id: null })
  })

  it("skips answered, undelivered, no-email and no_notification orders", () => {
    expect(planFeedbackSend(delivered, [{ id: "fb_1", answered_at: "2026-10-01" }])).toMatchObject({
      action: "skip",
      reason: expect.stringContaining("already answered"),
    })
    expect(planFeedbackSend({ ...delivered, fulfillments: [{ id: "f", delivered_at: null }] }, [])).toMatchObject({
      action: "skip",
      reason: "nothing delivered yet",
    })
    expect(planFeedbackSend({ ...delivered, email: "" }, [])).toMatchObject({ action: "skip", reason: "order has no email" })
    expect(planFeedbackSend({ ...delivered, metadata: { no_notification: true } }, [])).toMatchObject({
      action: "skip",
      reason: "order is marked no_notification",
    })
  })
})
