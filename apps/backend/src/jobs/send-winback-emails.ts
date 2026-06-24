import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { sendNotificationEmailWorkflow } from "../workflows/email/workflows/send-notification-email"
import { resolveFeedbackStoreBase } from "../workflows/feedback/lib/post-delivery-feedback"
import {
  buildWinbackEmailData,
  selectWinbackDue,
  type WinbackCustomerRow,
} from "../workflows/reengagement/lib/winback"

/**
 * #450 — lapsed-customer win-back trigger.
 *
 * Finds customers who have placed at least one order but whose most recent
 * order is older than `WINBACK_MIN_LAPSED_DAYS`, and emails them the `win-back`
 * template. Idempotent: each customer is stamped with
 * `metadata.winback_sent_at` after a successful send, and is only re-eligible
 * once `WINBACK_COOLDOWN_DAYS` have elapsed — so a re-run (or a still-lapsed
 * customer next cycle) never double-sends within the cooldown window.
 *
 * Best-effort / fail-soft — a missing template, missing email, or provider
 * error for one customer never aborts the batch. The pure selector
 * (`selectWinbackDue`) applies the lapsed / cooldown / cap filters so this job
 * stays thin and unit-testable.
 *
 * Independent of the #659 churn-based `marketing_outreach` exec-outreach
 * pipeline — this is the lifecycle email trigger, mirroring
 * `send-feedback-reminders.ts`.
 */
const MIN_LAPSED_DAYS = Number(process.env.WINBACK_MIN_LAPSED_DAYS || 90)
const COOLDOWN_DAYS = Number(process.env.WINBACK_COOLDOWN_DAYS || 180)
const MAX_BATCH = Number(process.env.WINBACK_MAX_BATCH || 100)
const MAX_SCAN = Number(process.env.WINBACK_MAX_SCAN || 2000)

export default async function sendWinbackEmails(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const customerService: any = container.resolve(Modules.CUSTOMER)
  const orderService: any = container.resolve(Modules.ORDER)

  try {
    // Real customers only (account holders). Lapsed-ness is decided from their
    // orders, fetched next.
    const customers: any[] = await customerService.listCustomers(
      { has_account: true },
      { select: ["id", "email", "first_name", "metadata"], take: MAX_SCAN }
    )

    if (!customers.length) {
      return
    }

    const ids = customers.map((c) => c.id)
    const orders: any[] = await orderService.listOrders(
      { customer_id: { $in: ids } },
      { select: ["customer_id", "created_at", "display_id"], take: 100000 }
    )

    // Reduce to per-customer order count + latest order (timestamp + display).
    const agg = new Map<
      string,
      { count: number; last_at: number; last_display: number | string | null }
    >()
    for (const o of orders) {
      const cid = o.customer_id
      if (!cid) {
        continue
      }
      const at = o.created_at ? new Date(o.created_at).getTime() : NaN
      const cur = agg.get(cid)
      if (!cur) {
        agg.set(cid, {
          count: 1,
          last_at: Number.isNaN(at) ? 0 : at,
          last_display: o.display_id ?? null,
        })
      } else {
        cur.count++
        if (!Number.isNaN(at) && at > cur.last_at) {
          cur.last_at = at
          cur.last_display = o.display_id ?? cur.last_display
        }
      }
    }

    const rows: WinbackCustomerRow[] = customers.map((c) => {
      const a = agg.get(c.id)
      return {
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        metadata: c.metadata,
        order_count: a?.count ?? 0,
        last_order_at: a && a.last_at ? new Date(a.last_at) : null,
        last_order_display: a?.last_display ?? null,
      }
    })

    const due = selectWinbackDue(rows, {
      minLapsedDays: MIN_LAPSED_DAYS,
      cooldownDays: COOLDOWN_DAYS,
      maxBatch: MAX_BATCH,
    })

    if (due.length === 0) {
      return
    }

    const shopBase = resolveFeedbackStoreBase(
      process.env as Record<string, string | undefined>
    )

    let sent = 0
    let skipped = 0
    for (const row of due) {
      try {
        const email = buildWinbackEmailData({ customer: row, shopBase })

        // No recipient → can't nudge; leave unstamped so a later run can retry.
        if (!email.to) {
          skipped++
          continue
        }

        await sendNotificationEmailWorkflow(container).run({
          input: {
            to: email.to,
            template: email.template,
            data: email.data,
          },
        })

        // Stamp idempotency marker (preserve existing metadata).
        await customerService.updateCustomers(row.id, {
          metadata: {
            ...(row.metadata || {}),
            winback_sent_at: new Date().toISOString(),
          },
        })
        sent++
      } catch (e: any) {
        skipped++
        logger.warn(
          `[winback] failed for customer ${row.id}: ${e?.message || e}`
        )
      }
    }

    if (sent + skipped > 0) {
      logger.info(`[winback] done — sent=${sent} skipped=${skipped}`)
    }
  } catch (e: any) {
    logger.error(`[winback] batch error: ${e?.message || e}`)
  }
}

export const config = {
  name: "send-winback-emails",
  schedule: "0 11 * * 1", // Weekly, Mondays at 11:00
}
