/**
 * The receipt form's arithmetic, kept pure (#2144).
 *
 * 🔴 The fact this screen exists to state: `Delivered` is a CARRIER event. It
 * comes from the Shiprocket webhook and proves a parcel reached a door. It
 * moves no stock, and it means nobody counted what was inside. Two pashminas
 * sat at `stocked_quantity: 0` at Kiyo Designs for nine days on the strength of
 * an OTP-verified scan, with nothing anywhere having failed.
 *
 * A receipt is SPLIT when one line lands in more than one place: the partner
 * keeps what they will cut and the balance goes to our own warehouse. Both
 * halves arrived — a split is not a short delivery and not a return. Goods
 * genuinely sent back to the supplier are an inspection matter on the order,
 * not a destination on this form.
 *
 * Pure so the sums can be tested without rendering, and because the same
 * over-receipt rule has to hold here as in the workflow: the server is the
 * authority, but a form that lets an operator type an impossible number and
 * only finds out on submit is a form that gets abandoned.
 */

/** Matches the server's tolerance exactly — fabric is metres, with decimals. */
export const OVER_RECEIPT_TOLERANCE = 0.01

const round = (n: number): number => Number(n.toFixed(6))

export type ReceiptLineView = {
  id: string
  label: string
  ordered: number
  /** Cumulative, from `line_fulfillments`. */
  received: number
  outstanding: number
  inventory_item_id: string | null
}

export type ReceiptPortion = {
  /** Local row key; never sent. */
  key: string
  quantity: string
  /** Empty string ⇒ follow the order's destination. */
  stock_location_id: string
}

export type ReceiptFormState = Record<string, ReceiptPortion[]>

export type OrderLineLike = {
  id?: string | null
  quantity?: number | string | null
  material_name?: string | null
  line_fulfillments?: Array<{ quantity_delta?: number | string | null }> | null
  inventory_items?: Array<{
    id?: string | null
    title?: string | null
    sku?: string | null
    variants?: Array<{
      title?: string | null
      product?: { title?: string | null } | null
    }> | null
  }> | null
}

/**
 * What a line says about itself: ordered, already received, still outstanding.
 *
 * `received` is Σ `quantity_delta`, the same cumulative record both receipt
 * doors write. Reading anything else here would let the screen disagree with
 * the guard that actually refuses an over-receipt.
 */
export function toReceiptLineView(line: OrderLineLike): ReceiptLineView {
  const ordered = Number(line?.quantity ?? 0) || 0
  const received = ((line?.line_fulfillments || []) as any[]).reduce(
    (sum, f) => sum + (Number(f?.quantity_delta) || 0),
    0
  )
  const item = (line?.inventory_items || [])[0]
  const variant = (item?.variants || [])[0]
  const label =
    line?.material_name ||
    // #1662 — a bare variant title ("M", "Red") names nothing on its own.
    [variant?.product?.title, variant?.title].filter(Boolean).join(" · ") ||
    item?.title ||
    item?.sku ||
    String(line?.id ?? "Line")

  return {
    id: String(line?.id ?? ""),
    label,
    ordered,
    received: round(received),
    outstanding: round(Math.max(0, ordered - received)),
    inventory_item_id: item?.id ? String(item.id) : null,
  }
}

/** The form's opening position: receive everything outstanding, where the order says. */
export function initialFormState(lines: ReceiptLineView[]): ReceiptFormState {
  const state: ReceiptFormState = {}
  for (const l of lines) {
    state[l.id] = [
      { key: `${l.id}-0`, quantity: l.outstanding ? String(l.outstanding) : "", stock_location_id: "" },
    ]
  }
  return state
}

export const sumPortions = (portions: ReceiptPortion[]): number =>
  round(
    portions.reduce((sum, p) => {
      const n = Number(p.quantity)
      return sum + (Number.isFinite(n) && n > 0 ? n : 0)
    }, 0)
  )

export type ReceiptValidation = {
  /** Per line id, a message. Empty ⇒ that line is fine. */
  lineErrors: Record<string, string>
  /** True when there is at least one positive quantity to send. */
  hasAnything: boolean
  canSubmit: boolean
}

export function validateReceipt(
  lines: ReceiptLineView[],
  state: ReceiptFormState
): ReceiptValidation {
  const lineErrors: Record<string, string> = {}
  let hasAnything = false

  for (const line of lines) {
    const portions = state[line.id] || []
    for (const p of portions) {
      if (p.quantity.trim() === "") {
        continue
      }
      const n = Number(p.quantity)
      if (!Number.isFinite(n)) {
        lineErrors[line.id] = `"${p.quantity}" is not a number`
      } else if (n < 0) {
        lineErrors[line.id] = "A received quantity cannot be negative"
      }
    }
    if (lineErrors[line.id]) {
      continue
    }

    const claimed = sumPortions(portions)
    if (claimed > 0) {
      hasAnything = true
    }
    // 🔴 The sum across the SPLIT, not each portion on its own. Two portions of
    // 50 against an 86 m line each look fine alone and are an over-receipt of
    // 14 m together — the same hole the server-side planner closes.
    if (claimed > line.outstanding + OVER_RECEIPT_TOLERANCE) {
      lineErrors[line.id] =
        `${claimed} claimed but only ${line.outstanding} outstanding` +
        (portions.length > 1 ? " across the split" : "")
    }
  }

  return {
    lineErrors,
    hasAnything,
    canSubmit: hasAnything && Object.keys(lineErrors).length === 0,
  }
}

export type ReceiptPayloadLine = {
  order_line_id: string
  quantity: number
  stock_location_id?: string
}

/**
 * Turn the form into the request body.
 *
 * Portions with no quantity are dropped rather than sent as 0 — the server
 * skips a 0 anyway, and a payload full of them makes the activity note
 * unreadable. A portion naming no location is sent WITHOUT one, so the server's
 * own destination resolution stays the single source of that truth rather than
 * the screen baking in whatever it happened to render.
 */
export function buildReceiptPayload(
  lines: ReceiptLineView[],
  state: ReceiptFormState
): ReceiptPayloadLine[] {
  const payload: ReceiptPayloadLine[] = []
  for (const line of lines) {
    for (const p of state[line.id] || []) {
      const n = Number(p.quantity)
      if (!Number.isFinite(n) || n <= 0) {
        continue
      }
      payload.push({
        order_line_id: line.id,
        quantity: n,
        ...(p.stock_location_id ? { stock_location_id: p.stock_location_id } : {}),
      })
    }
  }
  return payload
}

/**
 * Is this payload identical to "receive everything outstanding, as the order
 * says"? When it is, `lines` is omitted entirely and the server takes its own
 * default — the path that is exercised every time the MCP tool is called with
 * no lines, and therefore the better-worn one.
 */
export function isPlainFullReceipt(
  lines: ReceiptLineView[],
  payload: ReceiptPayloadLine[]
): boolean {
  if (payload.some((p) => p.stock_location_id)) {
    return false
  }
  const receivable = lines.filter((l) => l.outstanding > 0)
  if (payload.length !== receivable.length) {
    return false
  }
  return receivable.every((l) =>
    payload.some(
      (p) =>
        p.order_line_id === l.id &&
        Math.abs(p.quantity - l.outstanding) <= OVER_RECEIPT_TOLERANCE
    )
  )
}

/** Statuses the server will accept a receipt from. Mirrors RECEIVABLE_STATUSES. */
export const RECEIVABLE_STATUSES = [
  "Processing",
  "Ready for Delivery",
  "Shipped",
  "Partial",
  "Delivered",
]

export const canReceiveFrom = (status: string | null | undefined): boolean =>
  RECEIVABLE_STATUSES.includes(String(status ?? ""))
