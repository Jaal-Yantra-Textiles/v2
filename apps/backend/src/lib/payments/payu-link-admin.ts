import { oneapiHosts } from "../../api/store/payu/payment-link/lib"

/**
 * Switch a PayU payment link off (#2564).
 *
 * PUT {oneapi}/payment-links/{invoiceNumber} with `{ active: false }`, token
 * scope `update_payment_links` (docs.payu.in/reference/change-status-of-a-payment-link-api).
 * PayU answers `status: 0` on success and `status: -1` with a message on
 * failure — the HTTP code alone is not trusted.
 *
 * Never throws: returns `{ ok, error }` so a sweep can log and move on.
 */
export async function deactivatePayuLink(
  invoiceNumber: string
): Promise<{ ok: boolean; error: string | null }> {
  const clientId = process.env.PAYU_CLIENT_ID
  const clientSecret = process.env.PAYU_CLIENT_SECRET
  const merchantId = process.env.PAYU_MERCHANT_ID
  if (!clientId || !clientSecret || !merchantId) {
    return { ok: false, error: "PayU OneAPI not configured" }
  }
  if (!invoiceNumber) return { ok: false, error: "no invoice number" }
  const hosts = oneapiHosts(process.env.PAYU_ONEAPI_MODE)

  try {
    const tr = await fetch(hosts.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "update_payment_links",
      }).toString(),
    })
    const tj: any = await tr.json().catch(() => ({}))
    if (!tj.access_token) {
      return { ok: false, error: `PayU token request failed (${tr.status})` }
    }

    const r = await fetch(`${hosts.links}/${encodeURIComponent(invoiceNumber)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tj.access_token}`,
        merchantId: String(merchantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ active: false }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (r.ok && Number(j?.status) === 0) return { ok: true, error: null }
    return { ok: false, error: j?.message || `PayU answered ${r.status}` }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}
