import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { ORDER_APPROVAL_MODULE } from "../../modules/order-approval"
import { approvalUnusableReason, decideApproval } from "../../modules/order-approval/lib/decide"
import {
  APPROVAL_TTL_DAYS,
  approvalExpiryFrom,
  generateApprovalToken,
  hashApprovalToken,
} from "../../modules/order-approval/lib/token"
import { houseStorefrontOrigin } from "../../modules/partner-quote/lib/quote-link"
import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { sendNotificationEmailWorkflow } from "../../workflows/email/workflows/send-notification-email"
import { requestOrderBalanceWorkflow } from "../../workflows/payments/request-order-balance"

/**
 * The customer's finished-goods approval (#2463).
 *
 * We send a no-login link with photos of the finished batch; the customer
 * approves or rejects it once. A rejection is recorded and we are alerted —
 * nothing goes to the partner. An approval is recorded, we are alerted, and if
 * the order has a paid deposit with the balance still to collect, the balance
 * is raised and the customer is sent the pay link (founder, 2026-10-27).
 */

type Photo = { url: string; filename?: string | null }

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|avif)(\?|$)/i

/** PURE: the image media attached to a set of production runs, de-duplicated. */
export function photosFromRuns(runs: Array<{ metadata?: Record<string, any> | null }>): Photo[] {
  const seen = new Set<string>()
  const out: Photo[] = []
  for (const run of runs) {
    const media = Array.isArray(run?.metadata?.attached_media) ? run.metadata!.attached_media : []
    for (const m of media) {
      const url = typeof m?.url === "string" ? m.url : ""
      if (!url || seen.has(url)) continue
      const isImage =
        (typeof m?.mime_type === "string" && m.mime_type.startsWith("image/")) ||
        IMAGE_EXT.test(url)
      if (!isImage) continue
      seen.add(url)
      out.push({ url, filename: m?.filename ?? null })
    }
  }
  return out
}

const customerName = (order: any): string => {
  const first = order?.customer?.first_name || order?.shipping_address?.first_name
  return (typeof first === "string" && first.trim()) || "there"
}

const formatMoney = (amount: number | null | undefined, currency: string | null | undefined) => {
  if (amount === null || amount === undefined || !currency) return ""
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(Number(amount))
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

async function loadOrder(container: any, orderId: string) {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "customer.first_name",
      "shipping_address.first_name",
      "shipping_address.country_code",
      "items.id",
      "items.title",
      "items.quantity",
      "items.thumbnail",
    ],
    filters: { id: orderId },
  })
  return data?.[0] ?? null
}

/** Send a NON-throwing email; returns whether the provider accepted it. */
async function trySend(
  container: any,
  to: string,
  template: string,
  data: Record<string, any>
): Promise<boolean> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const run = await sendNotificationEmailWorkflow(container).run({
      input: { to, template, data } as any,
      throwOnError: false,
    })
    if (run?.errors?.length) {
      logger?.warn?.(
        `[order-approval] ${template} to ${to} not sent: ${run.errors
          .map((e: any) => e?.error?.message || e?.message)
          .join("; ")}`
      )
      return false
    }
    return true
  } catch (e: any) {
    logger?.warn?.(`[order-approval] ${template} to ${to} not sent: ${e?.message ?? e}`)
    return false
  }
}

export type RequestOrderApprovalInput = {
  order_id: string
  photo_urls?: string[] | null
  note?: string | null
  sent_by?: string | null
  now?: Date
}

export async function requestOrderApproval(container: any, input: RequestOrderApprovalInput) {
  const now = input.now ?? new Date()
  const approvals: any = container.resolve(ORDER_APPROVAL_MODULE)

  const order = await loadOrder(container, input.order_id)
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} not found`)
  }
  if (!order.email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order #${order.display_id} has no customer email to send the approval request to.`
    )
  }

  const given = (input.photo_urls ?? []).filter((u) => typeof u === "string" && u.trim())
  let photos: Photo[]
  if (given.length) {
    photos = given.map((url) => ({ url: url.trim() }))
  } else {
    const runs = await container
      .resolve(PRODUCTION_RUNS_MODULE)
      .listProductionRuns({ order_id: [order.id] }, { select: ["id", "metadata"] })
    photos = photosFromRuns(runs ?? [])
  }
  if (!photos.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No photos to show: none are attached to order #${order.display_id}'s production runs. ` +
        "Attach photos to the run, or pass photo_urls."
    )
  }

  const origin = houseStorefrontOrigin()
  if (!origin) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No storefront domain is configured (ROOT_DOMAIN / FRONTEND_URL), so no approval link can be built."
    )
  }

  // One open request per order: a newer one replaces the older link, so the
  // customer can't answer a request we no longer stand behind.
  const open = (await approvals.listForOrder(order.id)).filter((a: any) => a.status === "pending")
  if (open.length) {
    await approvals.updateOrderApprovals(
      open.map((a: any) => ({ id: a.id, status: "superseded" }))
    )
  }

  const token = generateApprovalToken()
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null
  const created = await approvals.createOrderApprovals({
    order_id: order.id,
    token_hash: token.hash,
    status: "pending",
    photos,
    note,
    sent_to: order.email,
    sent_by: input.sent_by ?? null,
    expires_at: approvalExpiryFrom(now),
  })
  const approval = Array.isArray(created) ? created[0] : created

  const country = String(order.shipping_address?.country_code || "in").toLowerCase()
  const approvalUrl = `${origin}/${country}/approvals/${token.raw}`

  const emailed = await trySend(container, order.email, "order-approval-request", {
    customer_name: customerName(order),
    order_display_id: order.display_id,
    approval_url: approvalUrl,
    note,
    ttl_days: APPROVAL_TTL_DAYS,
    current_year: now.getFullYear(),
  })

  return {
    id: approval.id,
    order_id: order.id,
    status: approval.status,
    photos,
    sent_to: order.email,
    expires_at: approval.expires_at,
    superseded: open.map((a: any) => a.id),
    approval_url: approvalUrl,
    emailed,
  }
}

/** What the customer's page shows. Never the hash, never another order's data. */
export async function getApprovalForToken(container: any, rawToken: string, now = new Date()) {
  const approvals: any = container.resolve(ORDER_APPROVAL_MODULE)
  const approval = rawToken ? await approvals.findByTokenHash(hashApprovalToken(rawToken)) : null
  if (!approval) return null

  const order = await loadOrder(container, approval.order_id)
  const unusable = approvalUnusableReason(approval, now)
  return {
    status: approval.status,
    answerable: !unusable,
    unavailable_reason: unusable && unusable.refusal !== "already_decided" ? unusable.message : null,
    order_display_id: order?.display_id ?? null,
    customer_name: customerName(order),
    items: (order?.items ?? []).map((i: any) => ({
      title: i.title,
      quantity: Number(i.quantity),
      thumbnail: i.thumbnail ?? null,
    })),
    photos: approval.photos ?? [],
    note: approval.note ?? null,
    expires_at: approval.expires_at ?? null,
    decided_at: approval.decided_at ?? null,
    decision_reason: approval.decision_reason ?? null,
    balance_pay_url: approval.balance_pay_url ?? null,
  }
}

export async function decideOrderApproval(
  container: any,
  input: { token: string; decision: unknown; reason: unknown; now?: Date }
) {
  const now = input.now ?? new Date()
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const approvals: any = container.resolve(ORDER_APPROVAL_MODULE)

  const approval = input.token
    ? await approvals.findByTokenHash(hashApprovalToken(input.token))
    : null
  const decision = decideApproval({
    approval,
    decision: input.decision,
    reason: input.reason,
    now,
  })
  if (!decision.ok) {
    const type =
      decision.refusal === "not_found"
        ? MedusaError.Types.NOT_FOUND
        : decision.refusal === "bad_decision" || decision.refusal === "reason_required"
          ? MedusaError.Types.INVALID_DATA
          : MedusaError.Types.NOT_ALLOWED
    throw new MedusaError(type, decision.message)
  }

  await approvals.updateOrderApprovals({
    id: approval.id,
    status: decision.decision,
    decided_at: now,
    decision_reason: decision.reason,
  })

  const order = await loadOrder(container, approval.order_id)
  let balanceSummary = "no balance on this order"
  let payUrl: string | null = null

  if (decision.decision === "approved") {
    try {
      const schedule = await container
        .resolve(PAYMENT_SCHEDULE_MODULE)
        .findByOrderId(approval.order_id)
      if (!schedule) {
        balanceSummary = "no deposit on this order — nothing raised"
      } else if (schedule.deposit_status !== "paid") {
        balanceSummary = `deposit is ${schedule.deposit_status} — balance not raised`
      } else if (schedule.balance_status === "paid") {
        balanceSummary = "balance already paid"
      } else {
        const { result } = await requestOrderBalanceWorkflow(container).run({
          input: { order_id: approval.order_id, requested_by: "customer_approval" },
        })
        const out = result as any
        payUrl = out?.pay_url ?? null
        const amount = out?.plan?.collectable ? out.plan.amount : null
        const currency = out?.plan?.collectable ? out.plan.currency_code : null
        if (payUrl) {
          await approvals.updateOrderApprovals({ id: approval.id, balance_pay_url: payUrl })
          balanceSummary = `${formatMoney(amount, currency) || "balance"} raised — link sent to the customer`
          if (out?.raised) {
            try {
              await container.resolve(Modules.EVENT_BUS).emit({
                name: "order.balance_due",
                data: {
                  id: approval.order_id,
                  order_id: approval.order_id,
                  payment_schedule_id: schedule.id,
                  amount,
                  currency_code: currency,
                  pay_url: payUrl,
                  trigger: "customer_approval",
                },
              })
            } catch (e: any) {
              logger?.warn?.(`[order-approval] balance_due emit failed: ${e?.message ?? e}`)
            }
          }
          if (order?.email) {
            const sent = await trySend(container, order.email, "order-approval-balance-due", {
              customer_name: customerName(order),
              order_display_id: order.display_id,
              balance_amount: formatMoney(amount, currency) || "the balance",
              pay_url: payUrl,
              current_year: now.getFullYear(),
            })
            if (!sent) balanceSummary += " (⚠️ the email did not send — share the link by hand)"
          }
        } else {
          balanceSummary = `balance not raised: ${out?.plan?.reason ?? "no reason given"}`
        }
      }
    } catch (e: any) {
      // The approval itself is recorded; a failed balance must reach a human.
      balanceSummary = `⚠️ raising the balance failed: ${e?.message ?? e}`
      logger?.warn?.(`[order-approval] ${approval.id}: ${balanceSummary}`)
    }
  }

  // Our alert. The feed is the source of truth; the email is a courtesy.
  const name = customerName(order)
  const title = `${name} ${decision.decision} order #${order?.display_id ?? ""}`
  try {
    await container.resolve(Modules.NOTIFICATION).createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title,
        description: decision.reason
          ? `"${decision.reason}" — ${balanceSummary}`
          : balanceSummary,
        metadata: {
          kind: "order_approval_decided",
          order_id: approval.order_id,
          order_approval_id: approval.id,
          decision: decision.decision,
          reason: decision.reason,
          balance_pay_url: payUrl,
          severity: decision.decision === "rejected" ? "warning" : "info",
          action_required: decision.decision === "rejected",
        },
      },
    })
  } catch (e: any) {
    logger?.warn?.(`[order-approval] feed alert failed for ${approval.id}: ${e?.message ?? e}`)
  }

  const adminTo = process.env.ADMIN_NOTIFY_EMAIL
  if (adminTo) {
    const backendUrl = process.env.MEDUSA_ADMIN_BACKEND_URL || process.env.BACKEND_URL || ""
    await trySend(container, adminTo, "order-approval-decided", {
      customer_name: name,
      order_display_id: order?.display_id ?? "",
      decision: decision.decision,
      reason: decision.reason,
      balance_summary: balanceSummary,
      admin_order_url: backendUrl
        ? `${backendUrl.replace(/\/$/, "")}/app/orders/${approval.order_id}`
        : "",
      current_year: now.getFullYear(),
    })
  }

  logger?.info?.(
    `[order-approval] ${approval.id} order=${approval.order_id} ${decision.decision} — ${balanceSummary}`
  )

  return {
    status: decision.decision,
    decided_at: now,
    balance_pay_url: payUrl,
  }
}
