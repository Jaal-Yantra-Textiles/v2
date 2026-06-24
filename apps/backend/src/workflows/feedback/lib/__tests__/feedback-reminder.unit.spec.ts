import {
  buildFeedbackReminderEmailData,
  feedbackReminderAlreadySent,
  selectFeedbackRemindersDue,
} from "../feedback-reminder"

const NOW = new Date("2026-06-24T10:00:00.000Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

const baseRow = (over: Record<string, any> = {}) => ({
  id: "fb_1",
  status: "pending",
  order_id: "order_1",
  submitted_at: daysAgo(10),
  metadata: { source: "post_delivery_request" },
  ...over,
})

describe("selectFeedbackRemindersDue", () => {
  it("returns pending post-delivery requests older than minAgeDays", () => {
    const due = selectFeedbackRemindersDue([baseRow()], { now: NOW, minAgeDays: 5 })
    expect(due.map((d) => d.id)).toEqual(["fb_1"])
  })

  it("skips requests younger than minAgeDays", () => {
    const due = selectFeedbackRemindersDue([baseRow({ submitted_at: daysAgo(2) })], {
      now: NOW,
      minAgeDays: 5,
    })
    expect(due).toEqual([])
  })

  it("skips non-pending, soft-deleted, and non-request rows", () => {
    const rows = [
      baseRow({ id: "reviewed", status: "reviewed" }),
      baseRow({ id: "deleted", deleted_at: daysAgo(1) }),
      baseRow({ id: "not-request", metadata: { source: "manual" } }),
    ]
    expect(selectFeedbackRemindersDue(rows, { now: NOW, minAgeDays: 5 })).toEqual([])
  })

  it("skips rows already reminded (idempotency)", () => {
    const row = baseRow({
      metadata: { source: "post_delivery_request", reminder_sent_at: NOW.toISOString() },
    })
    expect(selectFeedbackRemindersDue([row], { now: NOW, minAgeDays: 5 })).toEqual([])
    expect(feedbackReminderAlreadySent(row)).toBe(true)
    expect(feedbackReminderAlreadySent(baseRow())).toBe(false)
  })

  it("sorts oldest-first and caps at maxBatch", () => {
    const rows = [
      baseRow({ id: "a", submitted_at: daysAgo(8) }),
      baseRow({ id: "b", submitted_at: daysAgo(20) }),
      baseRow({ id: "c", submitted_at: daysAgo(12) }),
    ]
    const due = selectFeedbackRemindersDue(rows, { now: NOW, minAgeDays: 5, maxBatch: 2 })
    expect(due.map((d) => d.id)).toEqual(["b", "c"])
  })

  it("handles empty / nullish input", () => {
    expect(selectFeedbackRemindersDue(undefined)).toEqual([])
    expect(selectFeedbackRemindersDue(null)).toEqual([])
    expect(selectFeedbackRemindersDue([])).toEqual([])
  })
})

describe("buildFeedbackReminderEmailData", () => {
  it("builds the feedback-reminder payload with a display id and url", () => {
    const out = buildFeedbackReminderEmailData({
      order: { id: "order_1", display_id: 1042, email: "buyer@example.com" },
      customerName: "Asha",
      feedbackId: "fb_1",
      storeBase: "https://shop.example.com",
      now: NOW,
    })
    expect(out.template).toBe("feedback-reminder")
    expect(out.to).toBe("buyer@example.com")
    expect(out.data.order_display).toBe("#1042")
    expect(out.data.customer_name).toBe("Asha")
    expect(out.data.feedback_url).toBe("https://shop.example.com/feedback/fb_1")
    expect(out.data.store_url).toBe("https://shop.example.com")
    expect(out.data.current_year).toBe(2026)
  })

  it("falls back to order id and 'there', and empty url without a store base", () => {
    const out = buildFeedbackReminderEmailData({
      order: { id: "order_9", email: "" },
      feedbackId: "fb_9",
      storeBase: "",
      now: NOW,
    })
    expect(out.to).toBe("")
    expect(out.data.customer_name).toBe("there")
    expect(out.data.order_display).toBe("order_9")
    expect(out.data.feedback_url).toBe("")
  })
})
