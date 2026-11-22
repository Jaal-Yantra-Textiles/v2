/**
 * Captured money a cancelled order never gave back (#2580).
 *
 * 🔴 Medusa's `refundPaymentsStep` CATCHES a provider's refund error, logs it
 * as "Error was thrown trying to cancel payment" and carries on — and the
 * workflow still writes the order's −amount refund transaction. So a cancel
 * returns 200 and the order reads "refunded" while the provider never refunded
 * a paisa. Order #158 (2026-11-22): PayU answered in PHP-serialised form, our
 * provider threw on `response.json()`, and nothing said so but one log line.
 *
 * The truth is the payment's own refund rows: a refund the provider accepted
 * is recorded by the payment module; one it refused is not. This reads those.
 */

export type PaymentUnderTest = {
  id: string
  provider_id?: string | null
  currency_code?: string | null
  captures?: Array<{ amount: unknown }> | null
  refunds?: Array<{ amount: unknown }> | null
}

export type UnrefundedCapture = {
  payment_id: string
  provider_id: string | null
  currency_code: string | null
  captured: number
  refunded: number
  /** What is still with us. */
  outstanding: number
}

const cents = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export const findUnrefundedCaptures = (payments: PaymentUnderTest[]): UnrefundedCapture[] =>
  (payments || [])
    .map((p) => {
      const captured = (p.captures || []).reduce((a, c) => a + cents(c?.amount), 0)
      const refunded = (p.refunds || []).reduce((a, r) => a + cents(r?.amount), 0)
      return {
        payment_id: String(p.id),
        provider_id: p.provider_id ?? null,
        currency_code: p.currency_code ?? null,
        captured: captured / 100,
        refunded: refunded / 100,
        outstanding: (captured - refunded) / 100,
      }
    })
    .filter((r) => r.outstanding > 0)
