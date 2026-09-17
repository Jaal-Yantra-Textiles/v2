// #1970 item 2 (PR9) — approval closes the loop to the ORDER.
//
// `applyRunApprovals` already loads full run rows, so `order_id`,
// `order_line_item_id` and `produced_quantity` are in hand the whole time. It
// threw all three away: grepping `approve-run-output.ts` for
// `order_line_item_id` returned nothing. The run knows exactly which paid line
// it was commissioned for (#1953/#1955 stamp it at creation) and the line kept
// `variant_id: null` forever.
//
// 🔴 WHY A SECOND BINDER EXISTS. `create-product-from-design` already fills a
// missing `variant_id` on linked lines — but ONLY on the mint path. Approval
// calls the mint through `applyDesignProductPlan` exclusively in the
// `else if (!productExisted)` branch. So for every design whose product was
// ALREADY there — a second run, a re-approval, any design approved more than
// once — the mint never runs and the binding never happens. That is the shape
// that leaves a paid line unbound: the product exists, the run is stamped
// `approved`, and nothing connects the two to the order.
//
// 🔴 THE INVARIANT, above everything else here: THE ORDER TOTAL DOES NOT MOVE.
// The paid line's price is a cost estimate quoted to THAT customer at checkout
// (`estimateDesignCostWorkflow`, converted to cart currency). The approval
// price is a different number entirely — `computeRunCostSummary`'s
// `cost_per_unit` × the approval markup. Binding the line to the variant must
// carry NO price field, or the customer is silently re-charged the approval
// price for something they already bought. This planner therefore emits an
// explicit field list and nothing else can be written from it.

/** The ONLY fields a binding may write. Price is not here, and must never be. */
export const BINDABLE_LINE_FIELDS = [
  "variant_id",
  "product_id",
  "variant_sku",
  "variant_title",
  "product_title",
] as const

export type OrderLineBinding = {
  run_id: string
  line_item_id: string
  order_id: string | null
  variant_id: string
  product_id: string | null
  /** What the run says was actually made — carried for the fulfilment half. */
  produced_quantity: number | null
}

export type OrderLineBindingSkip = {
  run_id: string
  line_item_id: string | null
  reason:
    | "no_order_line" // the run was never bound to a paid line (#1918)
    | "no_variant" // approval could not name a variant (runs disagree)
    | "line_missing" // the line id no longer resolves
    | "already_bound" // the line has a variant — NEVER overwrite it
}

export type OrderLineBindingPlan = {
  bind: OrderLineBinding[]
  skip: OrderLineBindingSkip[]
}

/**
 * Decide, for a batch of just-approved runs, which paid order lines should be
 * bound to the variant the approval named. Pure: takes the runs and a lookup of
 * the current line rows, writes nothing.
 *
 * `lineById` is what the caller read back from the order module. A line absent
 * from it is reported as `line_missing` rather than assumed bindable — an
 * order can be canceled between the approval and this read, and binding a line
 * that is not there would throw inside a money path.
 */
export function planOrderLineBindings(
  runs: Array<{
    id: string
    order_id?: string | null
    order_line_item_id?: string | null
    approved_variant_id?: string | null
    approved_product_id?: string | null
    produced_quantity?: number | null
  }>,
  lineById: Map<string, { id: string; variant_id?: string | null }>
): OrderLineBindingPlan {
  const bind: OrderLineBinding[] = []
  const skip: OrderLineBindingSkip[] = []

  for (const run of runs) {
    const lineItemId = run.order_line_item_id || null

    /**
     * A run with no order line is the ordinary case, not a defect: a design
     * work-order commissioned without a customer behind it has nothing to
     * close a loop to. #1918 is the OTHER shape — a paid line whose run was
     * never stamped — and that is unreachable from here by construction.
     */
    if (!lineItemId) {
      skip.push({ run_id: run.id, line_item_id: null, reason: "no_order_line" })
      continue
    }

    /**
     * `resolveDesignApprovalTarget` refuses with a null variant when two runs
     * of one design made different variants. A refusal is a real answer and
     * must not be papered over by binding the line to whatever is nearby —
     * that is precisely the `products[0].variants[0]` mistake it exists to
     * prevent.
     */
    if (!run.approved_variant_id) {
      skip.push({ run_id: run.id, line_item_id: lineItemId, reason: "no_variant" })
      continue
    }

    const line = lineById.get(lineItemId)
    if (!line) {
      skip.push({ run_id: run.id, line_item_id: lineItemId, reason: "line_missing" })
      continue
    }

    /**
     * 🔴 NEVER overwrite a variant that is already there. A bound line is
     * either an ordinary catalogue purchase or a line some other design's
     * approval already answered for; re-pointing it would move a customer's
     * paid garment onto a different variant silently. This only ever FILLS IN
     * what is missing — the same rule `create-product-from-design` applies on
     * the mint path.
     */
    if (line.variant_id) {
      skip.push({ run_id: run.id, line_item_id: lineItemId, reason: "already_bound" })
      continue
    }

    bind.push({
      run_id: run.id,
      line_item_id: lineItemId,
      order_id: run.order_id ?? null,
      variant_id: run.approved_variant_id,
      product_id: run.approved_product_id ?? null,
      produced_quantity:
        typeof run.produced_quantity === "number" ? run.produced_quantity : null,
    })
  }

  return { bind, skip }
}

/**
 * Build the update payload for one binding. Separate from the planner so the
 * "no price field" rule is one expression that a test can assert directly,
 * rather than a property of a call site somebody edits later.
 */
export function buildLineBindingPayload(
  binding: OrderLineBinding,
  variantDetails?: {
    sku?: string | null
    title?: string | null
    product?: { title?: string | null } | null
  } | null
): Record<string, string> {
  const payload: Record<string, string> = { variant_id: binding.variant_id }

  if (binding.product_id) payload.product_id = binding.product_id
  if (variantDetails?.sku) payload.variant_sku = variantDetails.sku
  if (variantDetails?.title) payload.variant_title = variantDetails.title
  if (variantDetails?.product?.title) {
    payload.product_title = variantDetails.product.title
  }

  return payload
}
