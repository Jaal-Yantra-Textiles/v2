/**
 * The per-fulfillment platform-shipping ledger on a `partner_fee` row.
 *
 * `partner_fee` is one row per ORDER, but freight is booked per FULFILLMENT: an
 * order shipped in two boxes buys two waybills, on possibly two carriers, at two
 * rates. The original design stamped a single `shipping_amount` scalar, so the
 * second box's label overwrote the first box's cost and the partner was silently
 * under-charged — the gap the `Migration20260806120000` comment already flagged.
 *
 * Rather than reshape the table, the ledger lives in the row's existing jsonb:
 *
 *   metadata.shipping_charges  — one entry per fulfillment that has a live label
 *   metadata.shipping_reversals — entries retired by a cancelled waybill
 *
 * and `shipping_amount` / `shipping_currency_code` / `shipping_carrier` become
 * DERIVED: the rollup of the charges that are actually deductible. That is what
 * makes this safe to land without a migration — every existing reader (the
 * payout view, `summarize-fees`, any SQL over the column) keeps seeing a correct
 * scalar and needs no change, while the detail it was flattening is now kept.
 *
 * Pure and dependency-free so the whole ledger is unit-testable without a DB.
 */

/**
 * What a converted freight charge remembers about the conversion.
 *
 * A charge quoted in the carrier's currency is stored CONVERTED — `amount` and
 * `currency_code` are the ORDER's — because that is what makes it deductible
 * without every reader having to know about FX. That would be lossy on its own:
 * the carrier's invoice is in the original currency, and reconciling it against
 * a converted number is impossible unless the rate is kept. So the original is
 * kept alongside, and a payout can always be reconstructed from the row.
 *
 * `source` distinguishes a rate an operator actually paid from a market rate we
 * looked up — they differ, sometimes by several percent, and only the first
 * matches a bank statement.
 */
export type ShippingFxRecord = {
  /** Amount as the carrier billed it, before conversion. */
  original_amount: number
  /** Currency the carrier billed in. */
  original_currency_code: string
  /** Multiplier applied: `amount = original_amount * fx_rate`. */
  fx_rate: number
  /** `operator` = supplied by a human; `fx_rates` = the cached market rate. */
  fx_source: "operator" | "fx_rates"
  converted_at: string
}

/** One live freight charge, for one fulfillment. */
export type ShippingChargeLine = {
  /** The fulfillment whose label booked it. Null on a pre-ledger legacy row. */
  fulfillment_id: string | null
  amount: number
  currency_code: string
  carrier: string | null
  /** The waybill, so a carrier invoice line can be matched to it. */
  awb: string | null
  recorded_at: string | null
  /**
   * Present only when this line was converted. Absent means `amount` is exactly
   * what the carrier charged — which is every line written before FX existed,
   * and every line whose carrier already quoted in the order's currency.
   */
  fx: ShippingFxRecord | null
}

/** A charge that was deducted and has since been given back. */
export type ShippingReversal = {
  amount: number
  currency_code: string
  carrier: string | null
  awb: string | null
  fulfillment_id: string | null
  reversed_at: string
  reason: string | null
  reversed_by: string | null
  /**
   * Carried over from the charge being reversed, so a credit note in the
   * carrier's own currency can still be matched after the line is gone. `amount`
   * above is the converted figure that actually came off the payout.
   */
  fx?: ShippingFxRecord | null
}

/**
 * The parts of a `partner_fee` row the ledger reads.
 *
 * `id` is optional because the read helpers are also handed display-shaped rows
 * that never carry one (`describeFee`'s `PartnerFeeRowLike`); the two planners
 * require it and refuse to plan an update without it.
 */
export type LedgerFeeRow = {
  id?: string | null
  /** The ORDER's currency — decides which charges are deductible. */
  currency_code?: string | null
  shipping_amount?: number | string | null
  shipping_currency_code?: string | null
  shipping_carrier?: string | null
  metadata?: Record<string, any> | null
}

const toNum = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const upper = (v: unknown): string => String(v || "").toUpperCase()

/**
 * Read an FX record off a stored line, defensively — `metadata` is free-form
 * jsonb written by past and future versions of this code.
 *
 * A partial record is treated as ABSENT rather than patched with defaults. An
 * `fx_rate` of 0 or a missing original amount would silently misstate what a
 * partner was charged, and a line with no FX record is already a correct,
 * meaningful state ("this was never converted"). Failing back to it loses only
 * the audit trail; inventing a rate loses the money.
 */
function readFx(raw: any): ShippingFxRecord | null {
  if (!raw || typeof raw !== "object") {
    return null
  }
  const rate = Number(raw.fx_rate)
  const originalAmount = Number(raw.original_amount)
  const originalCurrency = upper(raw.original_currency_code)
  if (!Number.isFinite(rate) || rate <= 0) return null
  if (!Number.isFinite(originalAmount)) return null
  if (!originalCurrency) return null
  return {
    original_amount: originalAmount,
    original_currency_code: originalCurrency,
    fx_rate: rate,
    fx_source: raw.fx_source === "operator" ? "operator" : "fx_rates",
    converted_at: String(raw.converted_at || ""),
  }
}

/** Existing reversals, defensively — `metadata` is free-form jsonb. */
export function readShippingReversals(
  metadata: Record<string, any> | null | undefined
): ShippingReversal[] {
  const raw = metadata?.shipping_reversals
  return Array.isArray(raw) ? (raw as ShippingReversal[]) : []
}

/**
 * The live charges on a row, normalised.
 *
 * Falls back to synthesising ONE line from the legacy scalar when the ledger is
 * absent, which is the state of every row written before this existed. Without
 * that fallback a pre-ledger charge would vanish from the payout the moment this
 * shipped — silently paying partners more than they are owed — and a cancel
 * would find nothing to reverse. The synthesised line carries a null
 * `fulfillment_id` because the row genuinely does not record which box it was
 * for; reversal treats that as "the one charge on this order".
 */
export function readShippingCharges(
  fee: LedgerFeeRow | null | undefined
): ShippingChargeLine[] {
  if (!fee) {
    return []
  }
  const raw = fee.metadata?.shipping_charges
  if (Array.isArray(raw)) {
    return raw.map((c: any) => ({
      fulfillment_id: c?.fulfillment_id || null,
      amount: toNum(c?.amount),
      currency_code: upper(c?.currency_code || fee.currency_code),
      carrier: c?.carrier || null,
      awb: c?.awb || null,
      recorded_at: c?.recorded_at || null,
      fx: readFx(c?.fx),
    }))
  }
  if (fee.shipping_amount === null || fee.shipping_amount === undefined) {
    return []
  }
  return [
    {
      fulfillment_id: null,
      amount: toNum(fee.shipping_amount),
      currency_code: upper(fee.shipping_currency_code || fee.currency_code),
      carrier: fee.shipping_carrier || null,
      awb: null,
      recorded_at: null,
      // A legacy scalar row predates FX entirely: the column holds whatever the
      // carrier quoted, in whatever currency, with no rate recorded anywhere.
      fx: null,
    },
  ]
}

/**
 * Collapse the ledger back into the three scalar columns.
 *
 * Only charges in the ORDER's currency are summed. A carrier that quoted in its
 * own currency is deliberately excluded — the same rule `describeFee` has always
 * applied, for the same reason: folding it in would mean inventing an FX rate
 * here. Such a charge still exists as its own ledger line and is displayed; it
 * simply isn't part of the deductible scalar.
 *
 * `shipping_carrier` is only meaningful when one carrier is involved; a
 * two-carrier order gets null there and the per-line detail in the ledger.
 */
export function rollUpShippingScalars(
  charges: ShippingChargeLine[],
  orderCurrency: string | null | undefined
): {
  shipping_amount: number | null
  shipping_currency_code: string | null
  shipping_carrier: string | null
} {
  if (!charges.length) {
    return {
      shipping_amount: null,
      shipping_currency_code: null,
      shipping_carrier: null,
    }
  }
  const order = upper(orderCurrency)
  // With no order currency recorded we cannot tell "same currency" from
  // "foreign", so treat the first charge's currency as the reference rather than
  // dropping every line and reporting no shipping at all.
  const reference = order || charges[0].currency_code
  const deductible = charges.filter((c) => c.currency_code === reference)
  if (!deductible.length) {
    return {
      shipping_amount: null,
      shipping_currency_code: null,
      shipping_carrier: null,
    }
  }
  const carriers = Array.from(
    new Set(deductible.map((c) => c.carrier).filter(Boolean))
  )
  return {
    shipping_amount: deductible.reduce((s, c) => s + c.amount, 0),
    shipping_currency_code: reference,
    shipping_carrier: carriers.length === 1 ? (carriers[0] as string) : null,
  }
}

/** A freight charge to write onto the ledger. */
export type ShippingChargeInput = {
  fulfillment_id: string
  amount: number
  currency_code: string
  carrier: string | null
  awb?: string | null
  recorded_at: string
  /**
   * Set by the caller when `amount`/`currency_code` are already the CONVERTED,
   * order-currency figures. Resolving a rate needs the fx_rates module, which
   * this pure planner (and the module service that calls it) cannot reach under
   * module isolation — so conversion happens at the container edge and arrives
   * here as a finished fact. See `resolveShippingFx`.
   */
  fx?: ShippingFxRecord | null
}

/**
 * Convert a carrier's quote into the order's currency.
 *
 * Pure, and deliberately refuses more often than it succeeds: a rate that is
 * absent, zero, negative or not finite yields `null`, which the callers treat as
 * "leave the charge in its own currency" — the pre-FX behaviour, where the line
 * is displayed but never deducted. That is the safe direction. A bad rate does
 * not produce a wrong deduction; it produces no deduction, which is visible in
 * the UI as a foreign-currency line and gets asked about.
 *
 * Same-currency input returns `null` too: there is nothing to convert and
 * stamping an `fx_rate: 1` record would imply a conversion that never happened.
 */
export function planShippingFxConversion(input: {
  amount: number
  currency_code: string
  orderCurrency: string | null | undefined
  rate: number | null | undefined
  source: "operator" | "fx_rates"
  convertedAt: string
}): { amount: number; currency_code: string; fx: ShippingFxRecord } | null {
  const from = upper(input.currency_code)
  const to = upper(input.orderCurrency)
  if (!from || !to || from === to) {
    return null
  }
  const rate = Number(input.rate)
  if (!Number.isFinite(rate) || rate <= 0) {
    return null
  }
  const original = toNum(input.amount)
  // Money, so round to the minor unit. Left at full precision the payout picks
  // up a fraction of a cent that no invoice will ever agree with.
  const converted = Math.round(original * rate * 100) / 100
  return {
    amount: converted,
    currency_code: to,
    fx: {
      original_amount: original,
      original_currency_code: from,
      fx_rate: rate,
      fx_source: input.source,
      converted_at: input.convertedAt,
    },
  }
}

/**
 * The `updatePartnerFees` payload that records a fulfillment's freight.
 *
 * UPSERT by `fulfillment_id`, not append: re-generating a label for the same box
 * (the retry path, or a second attempt after a carrier hiccup) must correct that
 * box's cost, not charge for it twice.
 *
 * A legacy scalar-only row is absorbed on first write — its synthesised line is
 * claimed by this fulfillment when it is the only charge present, so an order
 * that was labelled before the ledger existed and then re-labelled doesn't end
 * up billed under both schemes.
 */
export function planShippingChargeUpsert(
  fee: LedgerFeeRow | null | undefined,
  charge: ShippingChargeInput
): Record<string, any> | null {
  if (!fee?.id || !charge.fulfillment_id) {
    return null
  }
  const existing = readShippingCharges(fee)
  const line: ShippingChargeLine = {
    fulfillment_id: charge.fulfillment_id,
    amount: toNum(charge.amount),
    currency_code: upper(charge.currency_code || fee.currency_code),
    carrier: charge.carrier || null,
    awb: charge.awb || null,
    recorded_at: charge.recorded_at,
    fx: readFx(charge.fx),
  }

  const claimsLegacyLine =
    existing.length === 1 && existing[0].fulfillment_id === null
  const next = claimsLegacyLine
    ? [line]
    : existing.some((c) => c.fulfillment_id === charge.fulfillment_id)
      ? existing.map((c) =>
          c.fulfillment_id === charge.fulfillment_id ? line : c
        )
      : [...existing, line]

  return {
    id: fee.id,
    ...rollUpShippingScalars(next, fee.currency_code),
    metadata: { ...(fee.metadata || {}), shipping_charges: next },
  }
}

export type ShippingReversalEvent = {
  /** The fulfillment whose waybill was cancelled — decides WHICH charge goes. */
  fulfillment_id?: string | null
  awb?: string | null
  reason?: string | null
  reversed_by?: string | null
  /** ISO timestamp; injected so the caller controls the clock. */
  reversed_at: string
}

/**
 * The payload that reverses ONE fulfillment's freight, or null when there is
 * nothing to reverse.
 *
 * Removes only the cancelled fulfillment's line and re-rolls the scalars, so an
 * order shipped in two boxes that loses one waybill keeps paying for the box
 * that is still travelling. Matching is by `fulfillment_id`, falling back to the
 * legacy null-id line so a charge recorded before the ledger existed can still
 * be cancelled.
 *
 * Returns null — rather than writing an empty reversal — when no line matches.
 * That covers the partner on their own carrier account, a carrier that never
 * quoted a rate, and a repeated cancel on the same fulfillment: the operation is
 * idempotent, so a retry after a partial failure cannot stack phantom reversals.
 *
 * A recorded 0 IS reversed. Free shipping is a real quoted outcome, and the
 * line's presence is what says "this box went on our carrier account"; absence
 * is the only thing that means nothing was charged.
 */
export function planShippingReversal(
  fee: LedgerFeeRow | null | undefined,
  event: ShippingReversalEvent
): { id: string; reversal: ShippingReversal; update: Record<string, any> } | null {
  if (!fee?.id) {
    return null
  }
  const charges = readShippingCharges(fee)
  if (!charges.length) {
    return null
  }

  const index = event.fulfillment_id
    ? charges.findIndex((c) => c.fulfillment_id === event.fulfillment_id)
    : -1
  // No per-fulfillment match: only a lone legacy line (which predates the
  // ledger and so cannot be attributed) may be claimed. Never guess at one of
  // several attributed lines — reversing the wrong box's freight is worse than
  // reversing none.
  const target =
    index >= 0
      ? index
      : charges.length === 1 && charges[0].fulfillment_id === null
        ? 0
        : -1
  if (target < 0) {
    return null
  }

  const removed = charges[target]
  const remaining = charges.filter((_, i) => i !== target)
  const reversal: ShippingReversal = {
    amount: removed.amount,
    currency_code: removed.currency_code,
    carrier: removed.carrier,
    awb: event.awb || removed.awb || null,
    fulfillment_id: event.fulfillment_id || removed.fulfillment_id || null,
    reversed_at: event.reversed_at,
    reason: event.reason || null,
    reversed_by: event.reversed_by || null,
    fx: removed.fx,
  }

  return {
    id: fee.id,
    reversal,
    update: {
      id: fee.id,
      ...rollUpShippingScalars(remaining, fee.currency_code),
      metadata: {
        ...(fee.metadata || {}),
        shipping_charges: remaining,
        shipping_reversals: [...readShippingReversals(fee.metadata), reversal],
      },
    },
  }
}
