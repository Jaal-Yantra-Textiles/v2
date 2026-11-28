import crypto from "crypto"
import type { BtcpayInvoice } from "./btcpay-client"

/**
 * 🔴 Only an invoice fetched FROM BTCPay decides that a checkout is paid.
 *
 * Payment-session `data` is buyer-writable (Medusa stores {...caller,
 * ...provider}; PayU learned this in #2656, where a made-up mihpayid placed
 * unpaid orders). So `invoice_id` in the session is a claim, not evidence:
 * a buyer could point it at ANOTHER settled invoice (a cheap one, or someone
 * else's). The fetched invoice must therefore:
 *   - carry THIS session's id in its metadata (we wrote it at creation),
 *   - be in the expected store and currency,
 *   - be Settled for at least the expected amount.
 *
 *   paid    → capture
 *   pending → keep waiting (New / Processing: seen in mempool, unconfirmed)
 *   review  → money arrived but not cleanly (partial, late, short) — a human
 *             reconciles in BTCPay; we never auto-place the order
 *   failed  → expired unpaid, invalid, or the invoice isn't this checkout's
 */
export type Verdict = { verdict: "paid" | "pending" | "review" | "failed"; reason: string }

export function invoiceVerdict(
  inv: BtcpayInvoice,
  expect: { sessionId?: string; amount: number; currency: string; storeId?: string }
): Verdict {
  const metaSession = inv.metadata?.medusa_session_id
  if (!expect.sessionId || metaSession !== expect.sessionId) {
    return { verdict: "failed", reason: `invoice ${inv.id} belongs to another checkout` }
  }
  if (expect.storeId && inv.storeId && inv.storeId !== expect.storeId) {
    return { verdict: "failed", reason: `invoice ${inv.id} is in store ${inv.storeId}, expected ${expect.storeId}` }
  }
  if (String(inv.currency || "").toUpperCase() !== String(expect.currency || "").toUpperCase()) {
    return { verdict: "failed", reason: `invoice currency ${inv.currency} ≠ ${expect.currency}` }
  }

  const extra = inv.additionalStatus || "None"
  switch (inv.status) {
    case "Settled": {
      if (extra === "PaidPartial") return { verdict: "review", reason: "settled but partially paid" }
      const invoiced = Number(inv.amount)
      if (!Number.isFinite(invoiced) || invoiced + 0.005 < expect.amount) {
        return { verdict: "review", reason: `invoice amount ${inv.amount} < expected ${expect.amount}` }
      }
      return { verdict: "paid", reason: extra === "Marked" ? "settled (marked by a BTCPay admin)" : "settled" }
    }
    case "New":
    case "Processing":
      return { verdict: "pending", reason: inv.status === "Processing" ? "paid, waiting for confirmation" : "awaiting payment" }
    case "Expired":
      if (extra === "PaidLate" || extra === "PaidPartial") return { verdict: "review", reason: `expired, ${extra}` }
      return { verdict: "failed", reason: "expired unpaid" }
    case "Invalid":
      return { verdict: "failed", reason: "invalid" }
    default:
      return { verdict: "pending", reason: `unknown status ${inv.status}` }
  }
}

/**
 * Per-store webhook secret, derived — so none is stored anywhere. We create
 * each store's webhook with this secret (BTCPay's create-webhook accepts our
 * own `secret`), and verify with the same derivation.
 */
export function storeWebhookSecret(masterSecret: string, storeId: string): string {
  return crypto.createHmac("sha256", masterSecret).update(`btcpay-webhook:${storeId}`).digest("hex")
}

/** `BTCPay-Sig: sha256=<hex HMAC-SHA256(secret, raw body)>`, constant-time. */
export function btcpaySignatureValid(rawBody: string | Buffer, header: unknown, secret: string): boolean {
  const got = String(Array.isArray(header) ? header[0] : header || "")
  if (!got.startsWith("sha256=")) return false
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  if (got.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

/**
 * Major-unit decimal string for BTCPay's `amount`. Medusa passes a number, a
 * BigNumber, or (on refunds) a raw `{ value, precision }` object.
 */
export function toBtcpayAmount(amount: unknown): string {
  const a: any = amount
  const n =
    typeof a === "number"
      ? a
      : a && typeof a === "object" && "value" in a && !("numeric" in a)
        ? Number(a.value)
        : Number(a)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`BTCPay: invalid amount ${String(amount)}`)
  return n.toFixed(2)
}
