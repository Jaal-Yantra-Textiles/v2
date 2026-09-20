import {
  completedWithoutOutput,
  completedWithoutProduct,
  isDependencyMet,
  isOpen,
  isUncommissioned,
  openWithoutPartner,
  partnerSilent,
} from "../absence"

/**
 * Every rule here was measured against the 146 real production runs on prod
 * (2026-09-20) before it was written. These tests pin the distinctions that
 * measurement turned up — above all the two places a falsy check would merge
 * two genuinely different answers.
 */
describe("production-run absence rules", () => {
  describe("completedWithoutOutput", () => {
    it("🔴 tells a produced_quantity of 0 apart from an unstated one", () => {
      /*
       * THE CASE THIS TEST EXISTS FOR. `0` means the run made nothing usable —
       * a real, reported answer. `null` means nobody ever said. A payout is
       * measured against this field, so merging them turns "we checked and the
       * answer is none" into "nobody checked".
       */
      expect(
        completedWithoutOutput({ id: "r", status: "completed", produced_quantity: 0 })
      ).toBe(false)
      expect(
        completedWithoutOutput({ id: "r", status: "completed", produced_quantity: null })
      ).toBe(true)
      expect(completedWithoutOutput({ id: "r", status: "completed" })).toBe(true)
    })

    it("says nothing about a run that is still running", () => {
      expect(
        completedWithoutOutput({ id: "r", status: "in_progress", produced_quantity: null })
      ).toBe(false)
      // 49 of the 146 are cancelled; a cancelled run owes no output.
      expect(
        completedWithoutOutput({ id: "r", status: "cancelled", produced_quantity: null })
      ).toBe(false)
    })
  })

  describe("completedWithoutProduct", () => {
    it("fires only once the run is finished", () => {
      expect(
        completedWithoutProduct({ id: "r", status: "completed", approved_product_id: null })
      ).toBe(true)
      expect(
        completedWithoutProduct({
          id: "r",
          status: "completed",
          approved_product_id: "prod_1",
        })
      ).toBe(false)
      expect(
        completedWithoutProduct({ id: "r", status: "in_progress", approved_product_id: null })
      ).toBe(false)
    })
  })

  describe("partnerSilent", () => {
    it("fires on an escalated reminder while the work is still open", () => {
      expect(
        partnerSilent({ id: "r", status: "in_progress", reminder_status: "escalated" })
      ).toBe(true)
    })

    it("stays quiet once the run is settled, and on a closed reminder", () => {
      // A completed run's reminder history is not a fault to raise.
      expect(
        partnerSilent({ id: "r", status: "completed", reminder_status: "escalated" })
      ).toBe(false)
      // Measured on prod: one live run sits at `closed`, which is answered.
      expect(
        partnerSilent({ id: "r", status: "awaiting_reassignment", reminder_status: "closed" })
      ).toBe(false)
      expect(partnerSilent({ id: "r", status: "in_progress", reminder_status: null })).toBe(
        false
      )
    })
  })

  describe("openWithoutPartner", () => {
    it("🔴 does not accuse a parent run that has children carrying the partner", () => {
      /*
       * 54 of 146 runs are children. On a pair the parent commonly has no
       * partner while the child does — asserting on the parent would raise a
       * fault on half the live board for a shape that is correct.
       */
      expect(openWithoutPartner({ id: "r", status: "in_progress" }, true)).toBe(false)
      expect(openWithoutPartner({ id: "r", status: "in_progress" }, false)).toBe(true)
    })

    it("stays quiet when someone is assigned, or the run is done", () => {
      expect(
        openWithoutPartner({ id: "r", status: "in_progress", partner_id: "pa_1" }, false)
      ).toBe(false)
      expect(openWithoutPartner({ id: "r", status: "completed" }, false)).toBe(false)
    })
  })

  describe("isDependencyMet", () => {
    it("🔴 is met at Delivered and NOT at Shipped", () => {
      /*
       * Proven on prod by the S1 run: of two attached orders, the Delivered one
       * was absent from the dispatch refusal and the Pending one was named.
       * Reading Shipped as met would release work to a partner who does not
       * have the cloth yet.
       */
      expect(isDependencyMet("Delivered")).toBe(true)
      expect(isDependencyMet("delivered")).toBe(true)
      expect(isDependencyMet("Shipped")).toBe(false)
      expect(isDependencyMet("Pending")).toBe(false)
      expect(isDependencyMet(null)).toBe(false)
      expect(isDependencyMet(undefined)).toBe(false)
    })
  })

  describe("isUncommissioned / isOpen", () => {
    it("reads a missing order line as uncommissioned", () => {
      expect(isUncommissioned({ id: "r" })).toBe(true)
      expect(isUncommissioned({ id: "r", order_line_item_id: "" })).toBe(true)
      expect(isUncommissioned({ id: "r", order_line_item_id: "ordli_1" })).toBe(false)
    })

    it("knows which statuses are still live", () => {
      for (const s of [
        "draft",
        "pending_review",
        "approved",
        "sent_to_partner",
        "in_progress",
        "awaiting_reassignment",
      ]) {
        expect(isOpen(s)).toBe(true)
      }
      expect(isOpen("completed")).toBe(false)
      expect(isOpen("cancelled")).toBe(false)
      expect(isOpen(null)).toBe(false)
    })
  })
})
