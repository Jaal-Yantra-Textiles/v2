/**
 * What currency a payout is denominated in, and how a line reaches it (#1612).
 *
 * ## Why this is not just `currency: "inr"`
 *
 * `createSubmissionRecordStep` hardcoded `currency: "inr"`. Every submission
 * ever written was INR, so nothing had exercised the alternative — but the
 * retail payout for order #79 is derived in USD ($280.85 order, $47.75
 * commission, $123.17 shipping) and settled in rupees, and the inventory
 * sources bring in partners whose own `currency_code` is not always set at all
 * (hrhandloom's is NULL).
 *
 * ## 🔴 The rule that matters: a missing rate is never 1
 *
 * The whole failure mode here is a conversion that silently doesn't happen.
 * `amount * (rate ?? 1)` looks defensive and bills USD figures as rupees —
 * off by ~88x, in the partner's favour or ours depending on direction, with
 * nothing in the record showing a conversion was even attempted.
 *
 * So `convertAmount` REFUSES a cross-currency line without a positive finite
 * rate rather than falling back. `FxRatesService.getRate` already throws when
 * no path is cached, and that throw must be allowed to propagate: refusing to
 * write a payout is recoverable, writing the wrong one is not. Cf. the
 * remembered FX rate that was 24% wrong (#1538), and `?? 1`-shaped defaults
 * generally.
 *
 * ## And the rate is RECORDED, not just applied
 *
 * A converted amount with no stored rate cannot be explained later — a partner
 * disputing "why is this ₹8,974" gets a bare number, and nobody can tell a
 * conversion from a typo. Every converted line carries its source amount,
 * source currency and the exact rate used, so the arithmetic can be replayed.
 */

export type ConversionRecord = {
  source_amount: number
  source_currency: string
  target_currency: string
  rate: number
  /** `amount` after conversion, rounded to 2dp. */
  converted_amount: number
}

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0

export const normaliseCurrency = (code: unknown): string =>
  String(code ?? "").trim().toLowerCase()

/**
 * The currency a submission is denominated in.
 *
 * Precedence: what the caller explicitly asked for, then the partner's own
 * `currency_code`, then `inr`.
 *
 * ⚠️ The partner fallback is deliberately second, not first. An admin recording
 * a payout they have already made in a particular currency is stating a fact,
 * and a partner default must not silently override it.
 *
 * ⚠️ `inr` last because a partner's `currency_code` is genuinely NULL on real
 * rows. A default is a guess, so it is the last resort rather than the first,
 * and it is one place rather than scattered through the callers.
 */
export function resolveSubmissionCurrency(input: {
  explicit?: string | null
  partnerCurrency?: string | null
  fallback?: string
}): string {
  return (
    normaliseCurrency(input.explicit) ||
    normaliseCurrency(input.partnerCurrency) ||
    normaliseCurrency(input.fallback) ||
    "inr"
  )
}

/**
 * PURE: convert one line's amount into the submission currency.
 *
 * Returns the amount unchanged, and `conversion: null`, when the currencies
 * already match — the common case, and one that must not require a rate or an
 * FX lookup.
 *
 * 🔴 Throws when the currencies differ and `rate` is not a positive finite
 * number. This is the guard, not a formality: see the docblock above.
 */
export function convertAmount(input: {
  amount: number
  from: string
  to: string
  rate?: number | null
}): { amount: number; conversion: ConversionRecord | null } {
  const from = normaliseCurrency(input.from)
  const to = normaliseCurrency(input.to)
  const amount = Number(input.amount)

  if (!Number.isFinite(amount)) {
    throw new Error(
      `Cannot convert a non-numeric amount (${input.amount}) from ${from} to ${to}`
    )
  }

  if (!from || !to || from === to) {
    return { amount, conversion: null }
  }

  if (!isPositiveFinite(input.rate)) {
    throw new Error(
      `Refusing to bill ${amount} ${from} as ${to} without an exchange rate. ` +
        `A missing rate is not 1 — the amount would be written unconverted. ` +
        `Ensure the FX cache has a path from ${from} to ${to}.`
    )
  }

  const converted = Math.round(amount * input.rate * 100) / 100

  return {
    amount: converted,
    conversion: {
      source_amount: amount,
      source_currency: from,
      target_currency: to,
      rate: input.rate,
      converted_amount: converted,
    },
  }
}

/**
 * Merge a conversion record into a line's `cost_breakdown`, preserving whatever
 * the pricing step already put there.
 *
 * Kept as a real field rather than `metadata` for the reason that field exists:
 * `metadata` is validated as `z.record(z.string(), z.any())` everywhere, so a
 * misspelt key validates cleanly and the audit trail silently isn't there.
 */
export function withConversion(
  costBreakdown: Record<string, unknown> | null | undefined,
  conversion: ConversionRecord | null
): Record<string, unknown> | null {
  if (!conversion) return costBreakdown ?? null

  return {
    ...(costBreakdown || {}),
    fx: conversion,
  }
}
