/**
 * Pure helpers for the customer "order edit confirmed" email.
 *
 * Medusa already emits `order-edit.confirmed` from `confirmOrderEditRequest`
 * with `{ order_id, actions, no_notification }` — the same shape and the same
 * `no_notification` convention as `order.canceled`. Nothing in this codebase
 * listened to it, so a confirmed edit changed the order and told the customer
 * nothing, while the `order-edit-confirmed` template sat active in the
 * database with no sender.
 *
 * Kept side-effect free so the send/skip decision and the template variables
 * are unit-testable without booting Medusa or a notification provider — same
 * split as `order-canceled-customer-email-lib`.
 */

/** One entry of the order change's `actions`, as the event carries them. */
export type OrderEditAction = {
  action?: string | null
  [key: string]: any
}

/**
 * The action types a CUSTOMER can see the result of.
 *
 * An edit that only rewrites order properties or replaces internal adjustments
 * changes nothing they would recognise, and "your order was edited" about it is
 * noise. Anything that adds, removes or re-quantifies what they receive — or
 * changes what they pay — is theirs to know.
 */
const CUSTOMER_VISIBLE_ACTIONS = new Set([
  "ITEM_ADD",
  "ITEM_REMOVE",
  "ITEM_UPDATE",
  "SHIPPING_ADD",
  "SHIPPING_REMOVE",
  "SHIPPING_UPDATE",
  "PROMOTION_ADD",
  "PROMOTION_REMOVE",
  "CREDIT_LINE_ADD",
])

export type OrderEditActionSummary = {
  added: number
  removed: number
  updated: number
  shipping: number
  other: number
  /** At least one action the customer would recognise. */
  customer_visible: boolean
  /**
   * Whether we actually know. FALSE when the event carried no `actions` array
   * — older Medusa versions omit it, and an absent list is not an empty one.
   */
  known: boolean
}

/** PURE: what the edit did, counted by kind. */
export function summariseOrderEditActions(
  actions?: OrderEditAction[] | null
): OrderEditActionSummary {
  const empty = {
    added: 0,
    removed: 0,
    updated: 0,
    shipping: 0,
    other: 0,
  }

  if (!Array.isArray(actions)) {
    /**
     * 🔴 Not `customer_visible: false`. A missing list is the event not telling
     * us, not the edit doing nothing — suppressing on it would silently stop
     * every email the day the payload shape changes.
     */
    return { ...empty, customer_visible: true, known: false }
  }

  const summary = { ...empty }
  for (const entry of actions) {
    switch (entry?.action) {
      case "ITEM_ADD":
        summary.added++
        break
      case "ITEM_REMOVE":
        summary.removed++
        break
      case "ITEM_UPDATE":
        summary.updated++
        break
      case "SHIPPING_ADD":
      case "SHIPPING_REMOVE":
      case "SHIPPING_UPDATE":
        summary.shipping++
        break
      default:
        summary.other++
    }
  }

  const customerVisible = actions.some(
    (entry) =>
      typeof entry?.action === "string" &&
      CUSTOMER_VISIBLE_ACTIONS.has(entry.action)
  )

  return { ...summary, customer_visible: customerVisible, known: true }
}

export interface OrderEditEmailDecisionInput {
  /** The retrieved order — only the fields that drive the decision. */
  order?: {
    email?: string | null
    metadata?: Record<string, any> | null
  } | null
  /** `no_notification` as carried on the `order-edit.confirmed` payload. */
  eventNoNotification?: boolean | null
  /** The change's actions, as carried on the same payload. */
  actions?: OrderEditAction[] | null
}

export interface OrderEditEmailDecision {
  send: boolean
  /** Recipient address — only set when `send` is true. */
  to?: string
  /** Human-readable reason a send was skipped, for the subscriber log. */
  reason?: string
}

/**
 * Decide whether to tell the customer their order edit was applied.
 *
 * Honours the same skip semantics as the cancellation email — an explicit flag
 * on the event, or `metadata.no_notification` on the order — plus one of its
 * own: an edit with no customer-visible action is not worth an email.
 */
export function shouldSendOrderEditConfirmedEmail(
  input: OrderEditEmailDecisionInput
): OrderEditEmailDecision {
  if (input.eventNoNotification) {
    return { send: false, reason: "no_notification flag on event" }
  }

  const order = input.order
  if (order?.metadata?.no_notification) {
    return { send: false, reason: "no_notification flag on order metadata" }
  }

  const summary = summariseOrderEditActions(input.actions)
  if (summary.known && !summary.customer_visible) {
    return {
      send: false,
      reason: "no customer-visible change in this edit",
    }
  }

  const to = (order?.email || "").trim()
  if (!to) {
    // Reported, not thrown: an order with no email is a data gap, not a reason
    // to fail the subscriber after the edit has already been applied.
    return { send: false, reason: "order has no customer email" }
  }

  return { send: true, to }
}

/**
 * PURE: an amount, with absence preserved.
 *
 * Medusa money fields are `BigNumberValue` — a number, a numeric string, or an
 * object carrying `numeric`. `Number(null)` is 0 and `Number(undefined)` is
 * NaN, so a missing total must not read as a real zero.
 */
export function readAmount(value: any): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "object") {
    return readAmount((value as any).numeric ?? (value as any).value ?? null)
  }
  if (typeof value === "string" && value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function formatMoney(amount: number, currencyCode?: string | null): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currencyCode || "inr").toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount} ${(currencyCode || "").toUpperCase()}`.trim()
  }
}

export type OrderEditConfirmedVars = {
  customer_first_name: string
  order_display_id: string | number
  /** Rendered under `{{#if difference_due}}` — empty string when none is owed. */
  difference_due: string
  current_year: number
  /** Extras: not in the template today, carried so it can grow without code. */
  order_id: string
  order_total: string
  items_added: number
  items_removed: number
  items_updated: number
}

/**
 * PURE: the FLAT variables the `order-edit-confirmed` template declares.
 *
 * Flat on purpose. A nested `{ order, customer }` payload is what made the
 * order-placed email render "Hi ," and "Order #" for months — Handlebars
 * resolves a missing key to an empty string and says nothing.
 */
export function buildOrderEditConfirmedVars({
  order,
  actions,
  now,
}: {
  order: any
  actions?: OrderEditAction[] | null
  now?: Date
}): OrderEditConfirmedVars {
  const firstName =
    order?.shipping_address?.first_name ||
    order?.billing_address?.first_name ||
    (order?.email ? String(order.email).split("@")[0] : "") ||
    "there"

  /**
   * Only a POSITIVE pending difference is money the customer now owes. A
   * negative one is a refund heading the other way, and the template labels
   * this "Additional amount" — so it is asked `> 0`, not `!= null`.
   */
  const pending = readAmount(order?.summary?.pending_difference)
  const currency = order?.currency_code ?? null
  const differenceDue =
    pending !== null && pending > 0 ? formatMoney(pending, currency) : ""

  const total = readAmount(order?.total)
  const summary = summariseOrderEditActions(actions)

  return {
    customer_first_name: firstName,
    order_display_id: order?.display_id ?? "",
    difference_due: differenceDue,
    current_year: (now ?? new Date()).getFullYear(),
    order_id: order?.id ?? "",
    order_total: total !== null ? formatMoney(total, currency) : "",
    items_added: summary.added,
    items_removed: summary.removed,
    items_updated: summary.updated,
  }
}
