import { NextRequest, NextResponse } from "next/server"
import { sdk } from "@lib/config"
import { cookies as nextCookies } from "next/headers"

function failedRedirect(
  countryCode: string,
  error: string,
  cartId: string | null,
  requestUrl: string
) {
  const params = new URLSearchParams()
  params.set("error", error)
  if (cartId) params.set("cart_id", cartId)
  return NextResponse.redirect(
    new URL(
      `/${countryCode}/checkout/payment-failed?${params.toString()}`,
      requestUrl
    )
  )
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const cartId = request.nextUrl.searchParams.get("cart_id")

  const status = formData.get("status")?.toString() || ""
  const txnid = formData.get("txnid")?.toString() || ""
  const mihpayid = formData.get("mihpayid")?.toString() || ""
  const hash = formData.get("hash")?.toString() || ""
  const amount = formData.get("amount")?.toString() || ""

  const cookies = await nextCookies()
  const countryCode = cookies.get("_medusa_country_code")?.value || "us"

  if (!cartId) {
    return failedRedirect(countryCode, "Missing cart reference", null, request.url)
  }

  if (status !== "success") {
    return failedRedirect(countryCode, "Payment was not successful", cartId, request.url)
  }

  try {
    const result = await sdk.client.fetch<{
      type: string
      order_id?: string
      error?: string
    }>("/store/payu/complete", {
      method: "POST",
      body: {
        cart_id: cartId,
        payu_status: status,
        mihpayid,
        txnid,
        hash,
        amount,
      },
    })

    if (result.type === "order" && result.order_id) {
      cookies.set("_medusa_cart_id", "", { maxAge: -1 })
      return NextResponse.redirect(
        new URL(`/${countryCode}/order/${result.order_id}/confirmed`, request.url)
      )
    }

    return failedRedirect(
      countryCode,
      result.error || "Payment could not be authorized",
      cartId,
      request.url
    )
  } catch (error: any) {
    console.error("[PayU Success] Error:", error?.message || error)
    return failedRedirect(
      countryCode,
      "Something went wrong completing your order",
      cartId,
      request.url
    )
  }
}
