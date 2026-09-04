import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

import { retrieveCart } from "@lib/data/cart"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ countryCode: string; cartId: string }> }
) {
  const { countryCode, cartId } = await params

  console.log(`[Cart Checkout Route] HIT — countryCode=${countryCode}, cartId=${cartId}, url=${request.url}`)

  const cookieStore = await cookies()
  cookieStore.set("_medusa_cart_id", cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  })

  /**
   * 🔴 The CART's country, not the URL's (#1787).
   *
   * This is the abandoned-cart recovery link, and the recovery flow builds it
   * with no country segment at all (`STORE_URL + "/checkout/cart/" + cart.id`).
   * The middleware therefore fills in `NEXT_PUBLIC_DEFAULT_REGION`, so the
   * buyer is handed to a checkout in the DEFAULT region regardless of what
   * their cart is priced in. For an AUD quote cart that means payment providers
   * resolve from India — PayU, never Stripe — and the address form's
   * region-scoped country select offers only `in` against an `au` address,
   * which blocks submit with no error anywhere.
   *
   * The cart already knows where it belongs, so ask it. Best-effort: a failed
   * lookup falls back to the old behaviour rather than stranding a buyer who
   * clicked a recovery mail.
   */
  let checkoutCountry = countryCode

  try {
    const cart = await retrieveCart(cartId, "id,region.countries.iso_2")
    const cartCountry = cart?.region?.countries?.[0]?.iso_2?.toLowerCase()

    if (cartCountry && cartCountry !== countryCode) {
      console.log(
        `[Cart Checkout Route] cart region country=${cartCountry} overrides url countryCode=${countryCode}`
      )
      checkoutCountry = cartCountry
    }
  } catch (e) {
    console.log(`[Cart Checkout Route] region lookup failed, keeping ${countryCode}`, e)
  }

  const redirectTo = `/${checkoutCountry}/checkout?step=address`
  console.log(`[Cart Checkout Route] → Redirecting to ${redirectTo}`)

  return NextResponse.redirect(
    new URL(redirectTo, request.url)
  )
}
