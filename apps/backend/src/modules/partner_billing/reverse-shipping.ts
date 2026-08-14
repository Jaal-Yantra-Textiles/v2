/**
 * Reversing the platform-shipping deduction when a waybill is cancelled.
 *
 * `recordPlatformShippingCost` stamps what a label cost us onto the order's
 * `partner_fee` row at label generation, and `describeFee` subtracts it from the
 * payout. Cancelling the waybill at the carrier used to leave that stamp exactly
 * where it was — so a partner kept paying freight for an AWB that no longer
 * existed, and the next label (on a carrier that may not quote a rate at all,
 * e.g. Delhivery) silently inherited the dead carrier's figure.
 *
 * A reversal therefore does two things, and the second is what makes it safe:
 *
 *   1. clears the active charge (`shipping_amount` → null), which stops the
 *      deduction and restores the payout, and
 *   2. appends the cleared figure to `metadata.shipping_reversals`, because a
 *      payout line that silently changes value between two views is the thing
 *      partners escalate. The reversal stays visible, and it carries the AWB —
 *      the only handle anyone has for matching a carrier credit note to it.
 *
 * Kept pure and dependency-free so the decision ("is there anything to reverse,
 * and what does the row look like afterwards") is unit-testable without a DB.
 */

/** One retired platform-shipping charge, as stored on `partner_fee.metadata`. */
export type ShippingReversal = {
  /** The amount that WAS being deducted and no longer is. */
  amount: number
  currency_code: string
  /** Carrier the reversed charge was booked on ("bluedart", "shiprocket", …). */
  carrier: string | null
  /** The cancelled waybill, for reconciling the carrier's credit note. */
  awb: string | null
  /** Fulfillment whose waybill was cancelled. */
  fulfillment_id: string | null
  reversed_at: string
  /** Operator's free-text cancellation reason, when given. */
  reason: string | null
  /** Admin email that performed the cancellation, when known. */
  reversed_by: string | null
}

/** The parts of a `partner_fee` row a reversal reads. */
export type ReversibleFeeRow = {
  id: string
  shipping_amount?: number | string | null
  shipping_currency_code?: string | null
  shipping_carrier?: string | null
  metadata?: Record<string, any> | null
}

export type ShippingReversalEvent = {
  awb?: string | null
  fulfillment_id?: string | null
  reason?: string | null
  reversed_by?: string | null
  /** ISO timestamp; injected so the caller controls the clock. */
  reversed_at: string
}

/** Existing reversals on a row, defensively — `metadata` is free-form jsonb. */
export function readShippingReversals(
  metadata: Record<string, any> | null | undefined
): ShippingReversal[] {
  const raw = metadata?.shipping_reversals
  return Array.isArray(raw) ? (raw as ShippingReversal[]) : []
}

/**
 * The `updatePartnerFees` payload that reverses the active shipping charge, or
 * `null` when there is nothing to reverse.
 *
 * Returns null — rather than writing an empty reversal — when the row carries no
 * active charge. That covers the partner who shipped on their own account, a
 * carrier that never quoted a rate, and (importantly) a second cancel on the
 * same fulfillment: the operation is idempotent, so a retry after a partial
 * failure can't stack phantom reversals.
 *
 * Note a recorded `0` IS reversed. Free shipping is a real quoted outcome and
 * the row's presence is what says "the partner used our carrier account", so
 * absence is the only thing that means nothing was charged.
 */
export function planShippingReversal(
  fee: ReversibleFeeRow | null | undefined,
  event: ShippingReversalEvent
): { id: string; reversal: ShippingReversal; update: Record<string, any> } | null {
  if (!fee?.id) {
    return null
  }
  const current = fee.shipping_amount
  if (current === null || current === undefined) {
    return null
  }
  const amount = Number(current)
  if (!Number.isFinite(amount)) {
    return null
  }

  const reversal: ShippingReversal = {
    amount,
    currency_code: (fee.shipping_currency_code || "").toUpperCase(),
    carrier: fee.shipping_carrier || null,
    awb: event.awb || null,
    fulfillment_id: event.fulfillment_id || null,
    reversed_at: event.reversed_at,
    reason: event.reason || null,
    reversed_by: event.reversed_by || null,
  }

  return {
    id: fee.id,
    reversal,
    update: {
      id: fee.id,
      // Back to "the partner did not use our shipping" — which is exactly what
      // is true again, and what the next label will overwrite from scratch.
      shipping_amount: null,
      shipping_currency_code: null,
      shipping_carrier: null,
      metadata: {
        ...(fee.metadata || {}),
        shipping_reversals: [...readShippingReversals(fee.metadata), reversal],
      },
    },
  }
}
