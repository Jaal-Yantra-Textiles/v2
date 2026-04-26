import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

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

  const redirectTo = `/${countryCode}/checkout?step=address`
  console.log(`[Cart Checkout Route] → Redirecting to ${redirectTo}`)

  return NextResponse.redirect(
    new URL(redirectTo, request.url)
  )
}
