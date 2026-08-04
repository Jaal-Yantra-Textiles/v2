import {
  CLOSED_ORDER_STATUSES,
  fulfillmentLineItemIds,
  isPickupFulfillment,
  needsRequiresShippingRepair,
  planOrderRepair,
  summarizeRequiresShippingBackfill,
} from "../backfill-open-order-requires-shipping-job"

const pickupOption = {
  service_zone: { fulfillment_set: { type: "pickup" } },
}
const shippingOption = {
  service_zone: { fulfillment_set: { type: "shipping" } },
}
/** A product that carries a shipping profile — the only kind that may be flipped. */
const profiled = { shipping_profile: { id: "sp_1" } }

describe("backfill-open-order-requires-shipping pure helpers (#1195)", () => {
  describe("isPickupFulfillment", () => {
    it("detects a pickup fulfillment set", () => {
      expect(isPickupFulfillment({ shipping_option: pickupOption })).toBe(true)
    })

    it("does not treat a shipping option as pickup", () => {
      expect(isPickupFulfillment({ shipping_option: shippingOption })).toBe(
        false
      )
    })

    it("does not treat a missing shipping option as pickup", () => {
      // Our manual side-channel fulfillments are shipped goods, not pickups.
      expect(isPickupFulfillment({})).toBe(false)
      expect(isPickupFulfillment({ shipping_option: null })).toBe(false)
      expect(isPickupFulfillment(null)).toBe(false)
    })
  })

  describe("needsRequiresShippingRepair", () => {
    it("flags the bug shape: live, non-pickup, stamped false", () => {
      expect(
        needsRequiresShippingRepair({
          id: "ful_1",
          requires_shipping: false,
          shipping_option: shippingOption,
        })
      ).toBe(true)
    })

    it("leaves an already-correct fulfillment alone (idempotent)", () => {
      expect(
        needsRequiresShippingRepair({
          id: "ful_1",
          requires_shipping: true,
          shipping_option: shippingOption,
        })
      ).toBe(false)
    })

    it("never flips a pickup fulfillment — that's the one documented rule", () => {
      expect(
        needsRequiresShippingRepair({
          id: "ful_1",
          requires_shipping: false,
          shipping_option: pickupOption,
        })
      ).toBe(false)
    })

    it("skips canceled fulfillments", () => {
      expect(
        needsRequiresShippingRepair({
          id: "ful_1",
          requires_shipping: false,
          canceled_at: "2026-08-01T00:00:00.000Z",
          shipping_option: shippingOption,
        })
      ).toBe(false)
    })

    it("does not act on an undefined flag (only an explicit false is the bug)", () => {
      expect(
        needsRequiresShippingRepair({ id: "ful_1", shipping_option: shippingOption })
      ).toBe(false)
      expect(needsRequiresShippingRepair(null)).toBe(false)
    })
  })

  describe("fulfillmentLineItemIds", () => {
    it("collects and dedupes line item ids", () => {
      expect(
        fulfillmentLineItemIds({
          items: [
            { line_item_id: "li_1" },
            { line_item_id: "li_2" },
            { line_item_id: "li_1" },
          ],
        })
      ).toEqual(["li_1", "li_2"])
    })

    it("skips rows with no line_item_id rather than guessing", () => {
      expect(
        fulfillmentLineItemIds({
          items: [{ line_item_id: "li_1" }, {}, { line_item_id: null }],
        })
      ).toEqual(["li_1"])
    })

    it("tolerates a fulfillment with no items", () => {
      expect(fulfillmentLineItemIds({})).toEqual([])
      expect(fulfillmentLineItemIds(null)).toEqual([])
    })
  })

  describe("planOrderRepair", () => {
    it("plans the fulfillment and the line items it covers", () => {
      const plan = planOrderRepair({
        id: "order_1",
        items: [
          { id: "li_1", requires_shipping: false, product: profiled },
          { id: "li_2", requires_shipping: false, product: profiled },
        ],
        fulfillments: [
          {
            id: "ful_1",
            requires_shipping: false,
            shipping_option: shippingOption,
            items: [{ line_item_id: "li_1" }],
          },
        ],
      })

      expect(plan.fulfillmentIds).toEqual(["ful_1"])
      // li_2 isn't in the fulfillment, so it isn't touched.
      expect(plan.lineItemIds).toEqual(["li_1"])
    })

    it("does not re-flip line items that are already true", () => {
      const plan = planOrderRepair({
        id: "order_1",
        items: [{ id: "li_1", requires_shipping: true, product: profiled }],
        fulfillments: [
          {
            id: "ful_1",
            requires_shipping: false,
            shipping_option: shippingOption,
            items: [{ line_item_id: "li_1" }],
          },
        ],
      })

      expect(plan.fulfillmentIds).toEqual(["ful_1"])
      expect(plan.lineItemIds).toEqual([])
    })

    it("leaves items covered only by a pickup fulfillment alone", () => {
      const plan = planOrderRepair({
        id: "order_1",
        items: [{ id: "li_1", requires_shipping: false, product: profiled }],
        fulfillments: [
          {
            id: "ful_1",
            requires_shipping: false,
            shipping_option: pickupOption,
            items: [{ line_item_id: "li_1" }],
          },
        ],
      })

      expect(plan.fulfillmentIds).toEqual([])
      expect(plan.lineItemIds).toEqual([])
    })

    it("still repairs an item shared with a pickup fulfillment when a shipped one covers it", () => {
      const plan = planOrderRepair({
        id: "order_1",
        items: [{ id: "li_1", requires_shipping: false, product: profiled }],
        fulfillments: [
          {
            id: "ful_pickup",
            requires_shipping: false,
            shipping_option: pickupOption,
            items: [{ line_item_id: "li_1" }],
          },
          {
            id: "ful_ship",
            requires_shipping: false,
            shipping_option: shippingOption,
            items: [{ line_item_id: "li_1" }],
          },
        ],
      })

      expect(plan.fulfillmentIds).toEqual(["ful_ship"])
      expect(plan.lineItemIds).toEqual(["li_1"])
    })

    it("repairs the fulfillment but NOT the line item when the product has no shipping profile", () => {
      // create-fulfillment.js:78-83 would then reject the remaining quantity:
      // `undefined !== sp_...` can never match the chosen option's profile.
      const plan = planOrderRepair({
        id: "order_1",
        items: [{ id: "li_1", requires_shipping: false, product: {} }],
        fulfillments: [
          {
            id: "ful_1",
            requires_shipping: false,
            shipping_option: shippingOption,
            items: [{ line_item_id: "li_1" }],
          },
        ],
      })

      expect(plan.fulfillmentIds).toEqual(["ful_1"])
      expect(plan.lineItemIds).toEqual([])
      // ...and it is REPORTED, not silently dropped.
      expect(plan.skippedLineItemIds).toEqual(["li_1"])
    })

    it("returns an empty plan for an order with no fulfillments", () => {
      const plan = planOrderRepair({
        id: "order_1",
        items: [{ id: "li_1", requires_shipping: false, product: profiled }],
        fulfillments: [],
      })

      expect(plan.fulfillmentIds).toEqual([])
      expect(plan.lineItemIds).toEqual([])
    })

    it("tolerates a malformed order object", () => {
      expect(planOrderRepair(null)).toEqual({
        fulfillmentIds: [],
        lineItemIds: [],
        skippedLineItemIds: [],
      })
    })
  })

  describe("summarizeRequiresShippingBackfill", () => {
    it("reports a clean scan", () => {
      expect(summarizeRequiresShippingBackfill(true, 12, 0, 0)).toContain(
        "No changes"
      )
    })

    it("uses conditional wording for dry-run vs apply", () => {
      expect(summarizeRequiresShippingBackfill(true, 12, 3, 5)).toContain(
        "Would set"
      )
      expect(summarizeRequiresShippingBackfill(false, 12, 3, 5)).toContain(
        "Set requires_shipping=true on 3 fulfillment(s) and 5 line item(s)"
      )
    })

    it("never hides a partial repair — skipped items and their cure are named", () => {
      const summary = summarizeRequiresShippingBackfill(false, 12, 3, 5, 7)
      expect(summary).toContain("SKIPPED 7 line item(s)")
      expect(summary).toContain("no shipping profile")
      expect(summary).toContain("backfill-product-shipping-profiles")
    })

    it("says so even when nothing else changed", () => {
      // The dangerous case: a run that repaired nothing AND skipped work would
      // otherwise read as "all clean".
      const summary = summarizeRequiresShippingBackfill(true, 12, 0, 0, 4)
      expect(summary).toContain("No changes")
      expect(summary).toContain("SKIPPED 4 line item(s)")
    })

    it("stays quiet when there is nothing to skip", () => {
      expect(summarizeRequiresShippingBackfill(false, 12, 3, 5, 0)).not.toContain(
        "SKIPPED"
      )
      expect(summarizeRequiresShippingBackfill(false, 12, 3, 5)).not.toContain(
        "SKIPPED"
      )
    })
  })

  describe("CLOSED_ORDER_STATUSES", () => {
    it("excludes terminal orders from the scan", () => {
      expect(CLOSED_ORDER_STATUSES).toEqual(
        expect.arrayContaining(["canceled", "archived", "completed"])
      )
    })
  })
})
