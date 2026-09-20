import {
  decideArrivalNotice,
  isArrival,
  MATERIAL_ARRIVED_STATUS,
} from "../material-arrival-notice"

describe("material arrival notice", () => {
  const arrival = { id: "inv_order_1", status: "Delivered", previous_status: "Shipped" }

  describe("isArrival", () => {
    it("🔴 fires on Delivered and NOT on Shipped", () => {
      /*
       * The same rule the run gate uses. If the customer were told at Shipped,
       * they would hear "your material has arrived" while production is still
       * correctly blocked waiting for it to actually arrive.
       */
      expect(isArrival(arrival)).toBe(true)
      expect(isArrival({ id: "inv_order_1", status: "Shipped" })).toBe(false)
      expect(isArrival({ id: "inv_order_1", status: "Pending" })).toBe(false)
      expect(MATERIAL_ARRIVED_STATUS).toBe("Delivered")
    })

    it("ignores an event with no order on it", () => {
      expect(isArrival({ status: "Delivered" })).toBe(false)
      expect(isArrival({})).toBe(false)
    })
  })

  describe("decideArrivalNotice", () => {
    it("🔴 sends for an attachment that never set notify_customer", () => {
      /*
       * THE CASE THIS TEST EXISTS FOR. Every row written before the column
       * existed reads as null. Treating that as "do not tell them" would make
       * the pipeline silently do nothing for exactly the attachments that are
       * already there — which is the failure this feature exists to end.
       */
      expect(decideArrivalNotice(arrival, [{ design_id: "d1" }])).toEqual({
        send: true,
        designIds: ["d1"],
      })
      expect(
        decideArrivalNotice(arrival, [{ design_id: "d1", notify_customer: null }])
      ).toEqual({ send: true, designIds: ["d1"] })
    })

    it("suppresses only an explicit false", () => {
      expect(
        decideArrivalNotice(arrival, [{ design_id: "d1", notify_customer: false }])
      ).toEqual({ send: false, reason: "all_suppressed_or_sent" })
    })

    it("🔴 does not announce the same arrival twice", () => {
      // An order corrected back to Shipped and delivered again fires a second
      // event for one arrival. The client should hear it once.
      expect(
        decideArrivalNotice(arrival, [
          { design_id: "d1", notified_at: "2026-09-20T10:00:00.000Z" },
        ])
      ).toEqual({ send: false, reason: "all_suppressed_or_sent" })
    })

    it("tells the designs it should and leaves the others alone", () => {
      expect(
        decideArrivalNotice(arrival, [
          { design_id: "d1" },
          { design_id: "d2", notify_customer: false },
          { design_id: "d3", notified_at: new Date() },
          { design_id: "d4", notify_customer: true },
        ])
      ).toEqual({ send: true, designIds: ["d1", "d4"] })
    })

    it("collapses a design attached twice", () => {
      expect(
        decideArrivalNotice(arrival, [{ design_id: "d1" }, { design_id: "d1" }])
      ).toEqual({ send: true, designIds: ["d1"] })
    })

    it("distinguishes 'nothing attached' from 'nobody to tell'", () => {
      // Two different problems with two different fixes: attach the order, or
      // look at why every attachment is suppressed.
      expect(decideArrivalNotice(arrival, [])).toEqual({
        send: false,
        reason: "nothing_attached",
      })
      expect(decideArrivalNotice({ id: "o", status: "Shipped" }, [])).toEqual({
        send: false,
        reason: "not_an_arrival",
      })
    })
  })
})
