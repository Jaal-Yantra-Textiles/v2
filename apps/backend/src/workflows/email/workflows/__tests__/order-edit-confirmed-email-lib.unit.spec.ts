import {
  buildOrderEditConfirmedVars,
  formatMoney,
  readAmount,
  shouldSendOrderEditConfirmedEmail,
  summariseOrderEditActions,
} from "../order-edit-confirmed-email-lib"

describe("order-edit.confirmed customer email — pure decision + variables", () => {
  const order = { email: "buyer@example.com", display_id: 29 }

  describe("shouldSendOrderEditConfirmedEmail", () => {
    it("sends when the edit adds an item and nothing suppresses it", () => {
      const d = shouldSendOrderEditConfirmedEmail({
        order,
        actions: [{ action: "ITEM_ADD" }],
      })
      expect(d).toEqual({ send: true, to: "buyer@example.com" })
    })

    it("honours no_notification on the event", () => {
      const d = shouldSendOrderEditConfirmedEmail({
        order,
        eventNoNotification: true,
        actions: [{ action: "ITEM_ADD" }],
      })
      expect(d.send).toBe(false)
      expect(d.reason).toMatch(/event/)
    })

    it("honours no_notification on the order's metadata", () => {
      const d = shouldSendOrderEditConfirmedEmail({
        order: { ...order, metadata: { no_notification: true } },
        actions: [{ action: "ITEM_ADD" }],
      })
      expect(d.send).toBe(false)
      expect(d.reason).toMatch(/metadata/)
    })

    it("stays quiet for an edit the customer cannot see", () => {
      const d = shouldSendOrderEditConfirmedEmail({
        order,
        actions: [
          { action: "UPDATE_ORDER_PROPERTIES" },
          { action: "ITEM_ADJUSTMENTS_REPLACE" },
        ],
      })
      expect(d.send).toBe(false)
      expect(d.reason).toMatch(/customer-visible/)
    })

    it("🔴 still sends when the event carried NO actions list", () => {
      // Absence is the event not telling us, not the edit doing nothing.
      // Treating it as "nothing visible" would silently stop every email.
      expect(shouldSendOrderEditConfirmedEmail({ order }).send).toBe(true)
      expect(
        shouldSendOrderEditConfirmedEmail({ order, actions: null }).send
      ).toBe(true)
    })

    it("stays quiet when there is nobody to mail", () => {
      const d = shouldSendOrderEditConfirmedEmail({
        order: { email: "   " },
        actions: [{ action: "ITEM_ADD" }],
      })
      expect(d.send).toBe(false)
      expect(d.reason).toMatch(/no customer email/)
    })
  })

  describe("summariseOrderEditActions", () => {
    it("counts each kind and reports the list as known", () => {
      const s = summariseOrderEditActions([
        { action: "ITEM_ADD" },
        { action: "ITEM_ADD" },
        { action: "ITEM_REMOVE" },
        { action: "ITEM_UPDATE" },
        { action: "SHIPPING_UPDATE" },
        { action: "UPDATE_ORDER_PROPERTIES" },
      ])
      expect(s).toEqual({
        added: 2,
        removed: 1,
        updated: 1,
        shipping: 1,
        other: 1,
        customer_visible: true,
        known: true,
      })
    })

    it("distinguishes an EMPTY list from a MISSING one", () => {
      expect(summariseOrderEditActions([])).toMatchObject({
        known: true,
        customer_visible: false,
      })
      expect(summariseOrderEditActions(undefined)).toMatchObject({
        known: false,
        customer_visible: true,
      })
    })
  })

  describe("readAmount", () => {
    it("preserves absence and unwraps a BigNumber shape", () => {
      expect(readAmount(null)).toBeNull()
      expect(readAmount(undefined)).toBeNull()
      expect(readAmount("")).toBeNull()
      expect(readAmount(0)).toBe(0)
      expect(readAmount("12.5")).toBe(12.5)
      expect(readAmount({ numeric: 340 })).toBe(340)
    })
  })

  describe("buildOrderEditConfirmedVars", () => {
    const now = new Date("2026-09-09T00:00:00Z")

    it("builds the FLAT keys the template declares", () => {
      const vars = buildOrderEditConfirmedVars({
        order: {
          id: "order_1",
          display_id: 29,
          email: "buyer@example.com",
          currency_code: "inr",
          total: 22401.8,
          shipping_address: { first_name: "Aline" },
          summary: { pending_difference: 340 },
        },
        actions: [{ action: "ITEM_ADD" }],
        now,
      })

      expect(vars.customer_first_name).toBe("Aline")
      expect(vars.order_display_id).toBe(29)
      expect(vars.difference_due).toBe(formatMoney(340, "inr"))
      expect(vars.current_year).toBe(2026)
      expect(vars.items_added).toBe(1)
      // Flat: a nested payload renders as empty strings and says nothing.
      expect(vars).not.toHaveProperty("order")
    })

    it("shows NO amount due when the difference is zero or a refund", () => {
      const base = {
        display_id: 3,
        currency_code: "inr",
        email: "b@x.com",
      }
      expect(
        buildOrderEditConfirmedVars({
          order: { ...base, summary: { pending_difference: 0 } },
          now,
        }).difference_due
      ).toBe("")
      expect(
        buildOrderEditConfirmedVars({
          order: { ...base, summary: { pending_difference: -500 } },
          now,
        }).difference_due
      ).toBe("")
      expect(
        buildOrderEditConfirmedVars({ order: base, now }).difference_due
      ).toBe("")
    })

    it("falls back through billing name, then the email, then 'there'", () => {
      expect(
        buildOrderEditConfirmedVars({
          order: { billing_address: { first_name: "Bo" }, now },
          now,
        }).customer_first_name
      ).toBe("Bo")
      expect(
        buildOrderEditConfirmedVars({ order: { email: "kim@x.com" }, now })
          .customer_first_name
      ).toBe("kim")
      expect(
        buildOrderEditConfirmedVars({ order: {}, now }).customer_first_name
      ).toBe("there")
    })
  })
})
