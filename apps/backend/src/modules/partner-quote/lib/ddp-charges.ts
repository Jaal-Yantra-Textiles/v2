/**
 * What a DDP undertaking actually costs us (#1447).
 *
 * ## Why this is not one number
 *
 * DHL Express's landed-cost planner, on a 70,000 INR consignment to NL:
 *
 * | | |
 * |---|---|
 * | Customs duty | 8% of (goods + freight) = **6,143.36** |
 * | Import VAT | 21% of (goods + freight + duty) = **17,416.43** |
 * | Duty-tax-paid fee | **1,981.57** — the carrier's charge for advancing it |
 *
 * 🔴 **The duty is the small half.** Import VAT is 2.8× larger, and a partner
 * who reads "duty" and types 6,143 under-funds a "nothing further to pay"
 * promise by roughly 19,400 on that shipment. The three are separate columns
 * for the same reason the tax status is separate from the tax total: when a
 * carrier invoice arrives months later, "which of the three was wrong" is the
 * only question worth being able to answer.
 *
 * ## The base cascades, which is what people get wrong by hand
 *
 * Duty is charged on the CIF value — goods plus freight and insurance — and
 * import VAT is then charged on that value INCLUDING the duty. Applying both
 * rates to the goods value alone under-states the total, silently and in our
 * favour, which is why the wizard collects RATES and this computes the amounts.
 *
 * ⚠️ `freight` here is the quote's own freight figure standing in for "freight
 * and insurance". A carrier's dutiable-freight definition can differ slightly
 * (DHL's planner excluded its own fuel surcharge from the duty base), so treat
 * the result as a good estimate of a real liability, not as a customs ruling.
 *
 * ## Two modes, never both
 *
 * Rates are the normal case. Amounts exist because not every tariff line is ad
 * valorem — a specific duty is charged per kilo or per item and no percentage
 * expresses it. Supplying both is refused rather than ranked, exactly like the
 * per-line discount/override pair (#1446): "which one wins" is a question that
 * should not have an answer.
 */

export type DdpChargeInput = {
  /** Goods total, in the quote currency. */
  subtotal: number
  /** The one freight leg, in the quote currency. */
  freight: number
  /** Ad valorem duty rate, e.g. 8 for 8%. */
  duty_rate_percent?: number | null
  /** Destination VAT/GST rate, e.g. 21 for 21%. */
  import_tax_rate_percent?: number | null
  /** A flat duty amount, for a specific (non-ad-valorem) tariff line. */
  duty_total?: number | null
  /** A flat import tax amount, where a rate does not express it. */
  import_tax_total?: number | null
  /** The carrier's advance/disbursement fee. Always an amount — it is a fee
   *  schedule, not a rate on the goods. */
  ddp_fee_total?: number | null
}

export type DdpCharges = {
  /** Goods + freight — the value duty is assessed on. */
  dutiable_value: number
  duty: number
  /** Assessed on `dutiable_value + duty`, not on the goods alone. */
  import_tax: number
  carrier_fee: number
  /** What the undertaking adds to the buyer's total. */
  total: number
  /** The rates actually applied, frozen so the figure can be re-derived. */
  duty_rate_percent: number | null
  import_tax_rate_percent: number | null
}

const money = (n: number) => Math.round(n * 100) / 100

const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)

/** True when this input names a rate AND an amount for the same charge. */
export function hasConflictingDdpInput(input: DdpChargeInput): boolean {
  return (
    (isNumber(input.duty_rate_percent) && isNumber(input.duty_total)) ||
    (isNumber(input.import_tax_rate_percent) && isNumber(input.import_tax_total))
  )
}

/**
 * PURE. Compute the three charges from whichever form the partner supplied.
 *
 * A missing rate AND a missing amount for a charge yields 0 for it — the caller
 * is responsible for refusing an EMPTY undertaking, because "zero duty on this
 * lane" and "nobody said" are different statements and only the validator has
 * the context to tell them apart.
 */
export function computeDdpCharges(input: DdpChargeInput): DdpCharges {
  const subtotal = isNumber(input.subtotal) ? input.subtotal : 0
  const freight = isNumber(input.freight) ? input.freight : 0
  const dutiableValue = money(subtotal + freight)

  const dutyRate = isNumber(input.duty_rate_percent)
    ? input.duty_rate_percent
    : null
  const importTaxRate = isNumber(input.import_tax_rate_percent)
    ? input.import_tax_rate_percent
    : null

  const duty = money(
    dutyRate !== null
      ? (dutiableValue * dutyRate) / 100
      : isNumber(input.duty_total)
        ? input.duty_total
        : 0
  )

  // 🔴 The cascade. The taxable value includes the duty just computed — this is
  // the line that makes 21% on a 76,792 base come out as 17,416 rather than
  // 16,126, and getting it wrong under-funds the promise by the difference.
  const taxableValue = money(dutiableValue + duty)
  const importTax = money(
    importTaxRate !== null
      ? (taxableValue * importTaxRate) / 100
      : isNumber(input.import_tax_total)
        ? input.import_tax_total
        : 0
  )

  const carrierFee = money(
    isNumber(input.ddp_fee_total) ? input.ddp_fee_total : 0
  )

  return {
    dutiable_value: dutiableValue,
    duty,
    import_tax: importTax,
    carrier_fee: carrierFee,
    total: money(duty + importTax + carrierFee),
    duty_rate_percent: dutyRate,
    import_tax_rate_percent: importTaxRate,
  }
}

/**
 * PURE: a one-line, human-readable derivation, for the frozen basis note.
 *
 * Written down because the person who meets the carrier's invoice months later
 * is not the person who typed the rates, and "8% + 21%" on its own does not say
 * what they were applied to.
 */
export function describeDdpBasis(charges: DdpCharges): string {
  const parts: string[] = []
  parts.push(
    charges.duty_rate_percent !== null
      ? `duty ${charges.duty_rate_percent}% of goods + freight`
      : `duty entered as a flat amount`
  )
  parts.push(
    charges.import_tax_rate_percent !== null
      ? `import tax ${charges.import_tax_rate_percent}% of goods + freight + duty`
      : `import tax entered as a flat amount`
  )
  if (charges.carrier_fee > 0) {
    parts.push(`carrier duty-tax-paid fee`)
  }
  return parts.join("; ")
}
