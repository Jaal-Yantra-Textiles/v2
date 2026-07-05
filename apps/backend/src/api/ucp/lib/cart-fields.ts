/**
 * Shared cart field constants for query.graph calls.
 * Ensures consistent data loading across all UCP route handlers.
 */
export const CHECKOUT_SESSION_CART_FIELDS = [
  "id",
  "region_id",
  "currency_code",
  "email",
  "completed_at",
  "metadata",
  "subtotal",
  "total",
  "tax_total",
  "shipping_total",
  "discount_total",
  "item_subtotal",
  "item_total",
  "items.*",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_address.*",
  "shipping_methods.*",
  "payment_collection.*",
  "payment_collection.payment_sessions.*",
  "payment_collection.payments.*",
  "order.id",
  "order.display_id",
]

export const CART_VALIDATION_FIELDS = [
  "id",
  "email",
  "completed_at",
  "metadata",
  "items.id",
  "shipping_address.id",
  "shipping_methods.id",
  "payment_collection.id",
  "payment_collection.payment_sessions.*",
]
