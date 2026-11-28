import { NextRequest, NextResponse } from "next/server"
import { cookies as nextCookies } from "next/headers"
import { checkBitcoinPayment } from "@lib/data/cart"

/**
 * BTCPay sends the buyer here after paying. Nothing in this request is
 * trusted: we just ask the backend whether the cart can complete now (it reads
 * the invoice from BTCPay itself). Usually it can't yet — on-chain payments
 * need a confirmation — so the buyer waits on the pending page.
 */
export async function GET(request: NextRequest) {
  const cartId = request.nextUrl.searchParams.get("cart_id")
  const cookies = await nextCookies()
  const cc = cookies.get("_medusa_country_code")?.value || "in"

  if (!cartId) {
    return NextResponse.redirect(new URL(`/${cc}/checkout/payment-failed?error=Missing%20cart%20reference`, request.url))
  }

  const r = await checkBitcoinPayment(cartId)
  if (r.status === "order") {
    return NextResponse.redirect(new URL(r.url, request.url))
  }
  if (r.status === "failed") {
    const q = new URLSearchParams({ error: r.error, cart_id: cartId })
    return NextResponse.redirect(new URL(`/${cc}/checkout/payment-failed?${q}`, request.url))
  }
  return NextResponse.redirect(
    new URL(`/${cc}/checkout/bitcoin-pending?cart_id=${encodeURIComponent(cartId)}`, request.url)
  )
}
