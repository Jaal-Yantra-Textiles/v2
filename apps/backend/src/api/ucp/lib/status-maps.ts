/**
 * UCP status mapping — maps Medusa cart state to UCP spec status values.
 *
 * Spec values: incomplete, requires_escalation, ready_for_complete,
 *              complete_in_progress, completed, canceled
 */

export type UcpStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled"

export function resolveUcpStatus(cart: any): UcpStatus {
  if (cart.metadata?.checkout_session_canceled) return "canceled"
  if (cart.completed_at) return "completed"
  if (cart.payment_collection?.status === "authorized") return "ready_for_complete"
  if (cart.items?.length > 0 && cart.email && cart.shipping_address?.address_1) return "ready_for_complete"
  return "incomplete"
}

export type MissingRequirement = "items" | "email" | "shipping_address"

export function resolveMissingRequirements(cart: any): MissingRequirement[] {
  const missing: MissingRequirement[] = []
  if (!cart.items || cart.items.length === 0) missing.push("items")
  if (!cart.email) missing.push("email")
  if (!cart.shipping_address?.address_1) missing.push("shipping_address")
  return missing
}
