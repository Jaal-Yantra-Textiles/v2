import { decideResubmit } from "../artisan-resubmit"

describe("decideResubmit", () => {
  it("refuses re-submission when the partner does not own the product", () => {
    const d = decideResubmit({ ownedByPartner: false, currentStatus: "rejected" })
    expect(d).toEqual({
      ok: false,
      code: "not_owner",
      reason: expect.any(String),
    })
  })

  it("allows re-submission of a rejected product → proposed", () => {
    const d = decideResubmit({ ownedByPartner: true, currentStatus: "rejected" })
    expect(d).toEqual({
      ok: true,
      nextStatus: "proposed",
      event: "partner_product.proposed",
    })
  })

  it("refuses re-submission of a product still under review (proposed)", () => {
    const d = decideResubmit({ ownedByPartner: true, currentStatus: "proposed" })
    expect(d.ok).toBe(false)
    expect((d as any).code).toBe("invalid_status")
  })

  it("refuses re-submission of a published product", () => {
    const d = decideResubmit({ ownedByPartner: true, currentStatus: "published" })
    expect(d.ok).toBe(false)
    expect((d as any).code).toBe("invalid_status")
  })

  it("refuses re-submission of a draft product", () => {
    const d = decideResubmit({ ownedByPartner: true, currentStatus: "draft" })
    expect(d.ok).toBe(false)
    expect((d as any).code).toBe("invalid_status")
  })
})
