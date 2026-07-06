import { engagementToOutreachEvent } from "../bridge-engagement"

describe("bridge-engagement — engagementToOutreachEvent", () => {
  const at = "2026-07-06T00:00:00.000Z"

  it("maps delivered → sent_at on the addressed row", () => {
    expect(engagementToOutreachEvent({ type: "delivered", message_id: "m1", at })).toEqual({
      external_id: "m1",
      sent_at: at,
    })
  })

  it("maps open AND click → opened_at (outreach has no clicked state)", () => {
    expect(engagementToOutreachEvent({ type: "open", message_id: "m1", at })).toEqual({
      external_id: "m1",
      opened_at: at,
    })
    expect(engagementToOutreachEvent({ type: "click", message_id: "m1", at })).toEqual({
      external_id: "m1",
      opened_at: at,
    })
  })

  it("returns null when it can't address a row or has no timestamp", () => {
    expect(engagementToOutreachEvent({ type: "open", message_id: null, at })).toBeNull()
    expect(engagementToOutreachEvent({ type: "open", message_id: "  ", at })).toBeNull()
    expect(engagementToOutreachEvent({ type: "open", message_id: "m1", at: "" })).toBeNull()
  })
})
