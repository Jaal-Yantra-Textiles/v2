import {
  shouldSendCustomerCancellationEmail,
  buildOrderCanceledCustomerEmailData,
} from "../order-canceled-customer-email"

/**
 * #576 slice A — pure helpers for the customer order-cancellation email.
 * No container / provider — fast coverage of the send/skip decision and the
 * Handlebars template-data assembly.
 */
describe("shouldSendCustomerCancellationEmail", () => {
  it("sends to the order email when present and not suppressed", () => {
    const d = shouldSendCustomerCancellationEmail({
      order: { email: "buyer@example.com" },
    })
    expect(d.send).toBe(true)
    expect(d.to).toBe("buyer@example.com")
  })

  it("trims surrounding whitespace from the recipient", () => {
    const d = shouldSendCustomerCancellationEmail({
      order: { email: "  buyer@example.com  " },
    })
    expect(d.send).toBe(true)
    expect(d.to).toBe("buyer@example.com")
  })

  it("skips when the event carries no_notification", () => {
    const d = shouldSendCustomerCancellationEmail({
      order: { email: "buyer@example.com" },
      eventNoNotification: true,
    })
    expect(d.send).toBe(false)
    expect(d.to).toBeUndefined()
    expect(d.reason).toMatch(/no_notification flag on event/)
  })

  it("skips when the order metadata sets no_notification", () => {
    const d = shouldSendCustomerCancellationEmail({
      order: { email: "buyer@example.com", metadata: { no_notification: true } },
    })
    expect(d.send).toBe(false)
    expect(d.reason).toMatch(/no_notification flag on order metadata/)
  })

  it("skips when there is no customer email", () => {
    expect(shouldSendCustomerCancellationEmail({ order: { email: "" } }).send).toBe(false)
    expect(shouldSendCustomerCancellationEmail({ order: { email: null } }).send).toBe(false)
    expect(shouldSendCustomerCancellationEmail({ order: null }).send).toBe(false)
    expect(shouldSendCustomerCancellationEmail({}).reason).toMatch(/no customer email/)
  })

  it("prioritises the no_notification skip over the missing-email skip", () => {
    const d = shouldSendCustomerCancellationEmail({
      order: { email: "" },
      eventNoNotification: true,
    })
    expect(d.reason).toMatch(/no_notification flag on event/)
  })
})

describe("buildOrderCanceledCustomerEmailData", () => {
  it("passes the order through and attaches a customer when customer_id is set", () => {
    const order = { id: "order_1", customer_id: "cus_1", email: "buyer@example.com" }
    const d = buildOrderCanceledCustomerEmailData(order)
    expect(d.order).toBe(order)
    expect(d.customer).toEqual({ first_name: "Customer" })
  })

  it("leaves customer null for guest orders (no customer_id)", () => {
    const d = buildOrderCanceledCustomerEmailData({ id: "order_2" })
    expect(d.customer).toBeNull()
  })
})
