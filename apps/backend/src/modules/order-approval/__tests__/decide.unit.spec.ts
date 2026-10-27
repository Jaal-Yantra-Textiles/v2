import { decideApproval } from "../lib/decide"
import { photosFromRuns } from "../../../lib/order-approval/order-approval"

const now = new Date("2026-10-27T12:00:00Z")
const pending = { status: "pending", expires_at: "2026-11-10T12:00:00Z" }

describe("decideApproval — answerable once, a reason to reject", () => {
  it("approves without a reason", () => {
    expect(decideApproval({ approval: pending, decision: "approved", reason: "", now })).toEqual({
      ok: true,
      decision: "approved",
      reason: null,
    })
  })

  it("rejects WITH a reason, trimmed", () => {
    expect(
      decideApproval({ approval: pending, decision: "rejected", reason: "  logo is crooked ", now })
    ).toEqual({ ok: true, decision: "rejected", reason: "logo is crooked" })
  })

  it.each(["", "   ", undefined, null])("refuses a rejection with reason %p", (reason) => {
    expect(
      decideApproval({ approval: pending, decision: "rejected", reason, now })
    ).toMatchObject({ ok: false, refusal: "reason_required" })
  })

  it.each(["approve", "yes", undefined, true])("refuses decision %p", (decision) => {
    expect(decideApproval({ approval: pending, decision, reason: "", now })).toMatchObject({
      ok: false,
      refusal: "bad_decision",
    })
  })

  // A second answer must not flip an approval we already raised a balance on.
  it.each(["approved", "rejected"])("refuses a request already %s", (status) => {
    expect(
      decideApproval({ approval: { status }, decision: "rejected", reason: "x", now })
    ).toMatchObject({ ok: false, refusal: "already_decided" })
  })

  it("refuses a superseded request", () => {
    expect(
      decideApproval({ approval: { status: "superseded" }, decision: "approved", reason: "", now })
    ).toMatchObject({ ok: false, refusal: "superseded" })
  })

  it("refuses an expired link", () => {
    expect(
      decideApproval({
        approval: { status: "pending", expires_at: "2026-10-27T11:59:59Z" },
        decision: "approved",
        reason: "",
        now,
      })
    ).toMatchObject({ ok: false, refusal: "expired" })
  })

  it("refuses an unknown link", () => {
    expect(
      decideApproval({ approval: null, decision: "approved", reason: "", now })
    ).toMatchObject({ ok: false, refusal: "not_found" })
  })
})

describe("photosFromRuns", () => {
  it("takes images from every run's attached media, once each", () => {
    expect(
      photosFromRuns([
        {
          metadata: {
            attached_media: [
              { url: "https://x/a.jpg", mime_type: "image/jpeg", filename: "a.jpg" },
              { url: "https://x/spec.pdf", mime_type: "application/pdf" },
              { url: "https://x/b.png" },
            ],
          },
        },
        { metadata: { attached_media: [{ url: "https://x/a.jpg", mime_type: "image/jpeg" }] } },
        { metadata: null },
      ])
    ).toEqual([
      { url: "https://x/a.jpg", filename: "a.jpg" },
      { url: "https://x/b.png", filename: null },
    ])
  })
})
