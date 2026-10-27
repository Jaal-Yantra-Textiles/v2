"use server"

import { sdk } from "@lib/config"

/**
 * The customer's finished-goods approval (#2463). The token in the URL IS the
 * credential, so it is never logged — only its length.
 */
export type OrderApprovalView = {
  status: "pending" | "approved" | "rejected" | "superseded"
  answerable: boolean
  unavailable_reason: string | null
  order_display_id: number | null
  customer_name: string
  items: Array<{ title: string; quantity: number; thumbnail: string | null }>
  photos: Array<{ url: string; filename?: string | null }>
  note: string | null
  expires_at: string | null
  decided_at: string | null
  decision_reason: string | null
  balance_pay_url: string | null
}

export const retrieveOrderApproval = async (
  token: string
): Promise<OrderApprovalView | null> => {
  try {
    const { order_approval } = await sdk.client.fetch<{ order_approval: OrderApprovalView }>(
      `/store/order-approvals/${encodeURIComponent(token)}`,
      { method: "GET", cache: "no-store" }
    )
    return order_approval ?? null
  } catch (e: any) {
    console.error(
      `[approvals] retrieve failed: token_len=${token?.length ?? 0} status=${e?.status ?? "n/a"} message=${e?.message ?? String(e)}`
    )
    return null
  }
}

export const decideOrderApproval = async (
  token: string,
  decision: "approved" | "rejected",
  reason?: string
): Promise<{ approval: OrderApprovalView | null; error: string | null }> => {
  try {
    const { order_approval } = await sdk.client.fetch<{ order_approval: OrderApprovalView }>(
      `/store/order-approvals/${encodeURIComponent(token)}/decision`,
      { method: "POST", body: { decision, reason: reason ?? "" }, cache: "no-store" }
    )
    return { approval: order_approval ?? null, error: null }
  } catch (e: any) {
    return {
      approval: null,
      error: e?.message || "We couldn't record your answer. Please try again, or reply to our email.",
    }
  }
}
