import { NextRequest, NextResponse } from "next/server"
import { sdk } from "@lib/config"
import { cookies as nextCookies } from "next/headers"

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const cartId = request.nextUrl.searchParams.get("cart_id")
  const errorMsg = formData.get("error_Message")?.toString() || "Payment failed"
  const txnid = formData.get("txnid")?.toString() || ""

  console.error(
    `[PayU Failure] cart_id=${cartId} txnid=${txnid} error=${errorMsg}`
  )

  // Tell the backend the payment failed — it will refresh the payment collection
  if (cartId) {
    try {
      await sdk.client.fetch("/store/payu/complete", {
        method: "POST",
        body: {
          cart_id: cartId,
          payu_status: "failure",
          txnid,
          mihpayid: "",
          hash: "",
          amount: "",
        },
      })
    } catch (e: any) {
      console.error("[PayU Failure] Backend call failed:", e.message)
    }
  }

  const countryCode =
    (await nextCookies()).get("_medusa_country_code")?.value || "us"

  const params = new URLSearchParams()
  params.set("error", errorMsg)
  if (cartId) params.set("cart_id", cartId)

  return NextResponse.redirect(
    new URL(
      `/${countryCode}/checkout/payment-failed?${params.toString()}`,
      request.url
    )
  )
}
