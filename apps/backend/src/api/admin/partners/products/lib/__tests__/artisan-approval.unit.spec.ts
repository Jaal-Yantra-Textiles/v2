import { decideApprovalTransition } from "../artisan-approval"

// #859 S2 (#861) — the pure approve/reject transition guard.
describe("decideApprovalTransition", () => {
  describe("ownership guard", () => {
    it("rejects any action on a non-artisan product", () => {
      const d = decideApprovalTransition("approve", {
        hasOwnerLink: false,
        currentStatus: "proposed",
      })
      expect(d).toEqual(
        expect.objectContaining({ ok: false, code: "not_artisan_owned" })
      )
    })
  })

  describe("approve", () => {
    it("publishes a proposed product and emits approved", () => {
      expect(
        decideApprovalTransition("approve", {
          hasOwnerLink: true,
          currentStatus: "proposed",
        })
      ).toEqual({
        ok: true,
        nextStatus: "published",
        event: "partner_product.approved",
      })
    })

    it("allows re-approving a previously rejected product", () => {
      expect(
        decideApprovalTransition("approve", {
          hasOwnerLink: true,
          currentStatus: "rejected",
        })
      ).toEqual({
        ok: true,
        nextStatus: "published",
        event: "partner_product.approved",
      })
    })

    it("refuses to re-approve an already-published product", () => {
      const d = decideApprovalTransition("approve", {
        hasOwnerLink: true,
        currentStatus: "published",
      })
      expect(d).toEqual(
        expect.objectContaining({ ok: false, code: "invalid_status" })
      )
    })

    it("refuses to approve a draft product", () => {
      const d = decideApprovalTransition("approve", {
        hasOwnerLink: true,
        currentStatus: "draft",
      })
      expect(d).toEqual(
        expect.objectContaining({ ok: false, code: "invalid_status" })
      )
    })
  })

  describe("reject", () => {
    it("rejects a proposed product and emits rejected", () => {
      expect(
        decideApprovalTransition("reject", {
          hasOwnerLink: true,
          currentStatus: "proposed",
        })
      ).toEqual({
        ok: true,
        nextStatus: "rejected",
        event: "partner_product.rejected",
      })
    })

    it("refuses to reject a published product", () => {
      const d = decideApprovalTransition("reject", {
        hasOwnerLink: true,
        currentStatus: "published",
      })
      expect(d).toEqual(
        expect.objectContaining({ ok: false, code: "invalid_status" })
      )
    })
  })
})
