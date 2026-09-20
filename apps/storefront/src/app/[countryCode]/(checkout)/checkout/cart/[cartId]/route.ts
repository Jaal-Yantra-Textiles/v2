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
    const cart = await retrieveCart(
      cartId,
      "id,shipping_address.country_code,region.countries.iso_2"
    )

    const regionCountries = (cart?.region?.countries ?? [])
      .map((c: { iso_2?: string | null }) =>
        String(c?.iso_2 ?? "").trim().toLowerCase()
      )
      .filter(Boolean)

    const cartCountry = String(cart?.shipping_address?.country_code ?? "")
      .trim()
      .toLowerCase()

    const urlCountry = String(countryCode ?? "").trim().toLowerCase()

    if (cartCountry && regionCountries.includes(cartCountry)) {
      /**
       * The buyer's OWN country, which is what this block always claimed to
       * use. It previously read `region.countries[0]` — the region's first
       * country, in whatever order the API returned it — and overrode the URL
       * with it. A Swedish buyer on a correct `/se/` link was sent to `/at/`
       * locally and `/al/` (Albania) in production, purely because those rows
       * happened to come back first.
       */
      checkoutCountry = cartCountry
    } else if (urlCountry && regionCountries.includes(urlCountry)) {
      /**
       * No country on the cart, but the link named one this region serves.
       * Honour it — it is the only real signal about the buyer, and
       * overriding it is what broke `/se/`.
       */
      checkoutCountry = urlCountry
    } else if (regionCountries.length === 1) {
      // One country: unambiguous, so the region CAN answer.
      checkoutCountry = regionCountries[0]
    } else if (regionCountries.length > 1) {
      /**
       * ⚠️ LAST RESORT and a genuine guess: the cart names no country and the
       * link's country is not in its region, so nothing here knows where the
       * buyer is. Logged as a guess rather than reported as a decision — the
       * real fix is the country being set when the order is created.
       */
      checkoutCountry = regionCountries[0]
      console.log(
        `[Cart Checkout Route] GUESSING ${checkoutCountry} for cart ${cartId}: ` +
          `cart names no country and url "${urlCountry}" is not in its region ` +
          `(${regionCountries.join(",")})`
      )
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
