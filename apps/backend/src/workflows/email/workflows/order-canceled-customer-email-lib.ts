// Pure helpers for the customer "order canceled" email (#576 slice A).
// Kept side-effect free so the send/skip decision and template-data assembly are
// unit-testable without booting Medusa or a notification provider.

export interface CustomerCancellationDecisionInput {
  /** The retrieved order (only the fields that drive the decision). */
  order?: {
    email?: string | null
    metadata?: Record<string, any> | null
  } | null
  /** `no_notification` flag carried on the order.canceled event payload, if any. */
  eventNoNotification?: boolean | null
}

export interface CustomerCancellationDecision {
  send: boolean
  /** Recipient address — only set when `send` is true. */
  to?: string
  /** Human-readable reason a send was skipped (for the subscriber log). */
  reason?: string
}

/**
 * Decide whether to send the customer an order-cancellation email.
 *
 * Honours the same `no_notification` skip semantics the fulfillment email uses:
 * an explicit flag on the event payload OR `metadata.no_notification` on the
 * order suppresses the send. A missing/blank customer email also skips (there is
 * nobody to mail) rather than throwing.
 */
export function shouldSendCustomerCancellationEmail(
  input: CustomerCancellationDecisionInput
): CustomerCancellationDecision {
  if (input.eventNoNotification) {
    return { send: false, reason: "no_notification flag on event" }
  }

  const order = input.order
  if (order?.metadata?.no_notification) {
    return { send: false, reason: "no_notification flag on order metadata" }
  }

  const to = (order?.email || "").trim()
  if (!to) {
    return { send: false, reason: "order has no customer email" }
  }

  return { send: true, to }
}

/**
 * Assemble the Handlebars data for the `order-canceled` customer template.
 * Mirrors the order-placed customer send so both share one shape:
 * `{ order, customer }`.
 */
export function buildOrderCanceledCustomerEmailData(order: {
  customer_id?: string | null
  [key: string]: any
}): { order: any; customer: { first_name: string } | null } {
  return {
    order,
    customer: order?.customer_id ? { first_name: "Customer" } : null,
  }
}
