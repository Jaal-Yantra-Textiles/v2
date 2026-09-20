import {
  decideArrivalNotice,
  isArrival,
  MATERIAL_ARRIVED_STATUS,
  stampedAttachmentData,
  designsCoveredByProductionStart,
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

describe("stampedAttachmentData", () => {
  it("🔴 carries notify_customer forward instead of dropping it", () => {
    /*
     * THE CASE THIS EXISTS FOR. Extra columns on a link are changed by dismiss
     * + create, so the create writes the WHOLE row. Stamping only notified_at
     * would erase a client's explicit "do not tell me" and silently revert them
     * to the sending default at the next delivery — with the row looking
     * untouched. Same shape as a variant price save replacing the entire set.
     */
    const now = new Date("2026-09-20T12:00:00.000Z")

    expect(
      stampedAttachmentData({ design_id: "d1", notify_customer: false, note: "silk only" }, now)
    ).toEqual({ notify_customer: false, note: "silk only", notified_at: now })
  })

  it("keeps the sending default for a row that never set the column", () => {
    const now = new Date()
    expect(stampedAttachmentData({ design_id: "d1" }, now)).toEqual({
      notify_customer: true,
      note: null,
      notified_at: now,
    })
  })
})

describe("designsCoveredByProductionStart", () => {
  it("🔴 covers a design whose waiting run can actually dispatch", () => {
    /*
     * Delivery already releases such a run, and dispatch emits
     * design.production_started — which emails the client "production has
     * started". Sending the arrival mail too would be two mails, seconds
     * apart, about one event.
     */
    expect(
      designsCoveredByProductionStart([
        { design_id: "d1", dispatch_template_ids: ["tpl_1"] },
        { design_id: "d2", dispatch_template_names: ["Sampling"] },
      ])
    ).toEqual(new Set(["d1", "d2"]))
  })

  it("🔴 does NOT cover a run that named no templates", () => {
    /*
     * `selectDispatchInput` returns null for it, so the release dispatches
     * nothing and no production-started mail is sent. The arrival mail is then
     * the only thing the client would hear, and it must go.
     */
    expect(
      designsCoveredByProductionStart([
        { design_id: "d1" },
        { design_id: "d2", dispatch_template_ids: [] },
        { design_id: "d3", dispatch_template_names: [""] },
      ])
    ).toEqual(new Set())
  })

  it("ignores a run with no design on it", () => {
    expect(
      designsCoveredByProductionStart([{ dispatch_template_ids: ["tpl_1"] }])
    ).toEqual(new Set())
    expect(designsCoveredByProductionStart([])).toEqual(new Set())
  })
})
