import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../lib/bot-recipients"
import { verifyBalanceLinkViaOneApi } from "../lib/payments/payu-balance"
import { deactivatePayuLink } from "../lib/payments/payu-link-admin"
import {
  decideLinkSweep,
  formatExpiryForBuyer,
  PAYU_LINK_METADATA_KEY,
  readTrackedLink,
  type TrackedPayuLink,
} from "../lib/payments/payu-link-expiry"
import { sendDesignOrderPaymentExpiredEmailWorkflow } from "../workflows/email/workflows/send-design-order-payment-expired-email"

/**
 * #2564 — close design-order PayU links that should no longer take money, and
 * tell the buyer when theirs expired.
 *
 * PayU sends no "expired" event, so this is the only thing that acts on
 * `cart.metadata.payu_link.expires_at`. Each run:
 *
 * - expired + unpaid → switch the link off at PayU, email "payment link
 *   expired" (the cart's checkout still works — the email says so)
 * - cart completed or design order cancelled → switch the link off, no email.
 *   An open link on a paid cart invites a second payment.
 *
 * 🔴 Before emailing "expired" it asks PayU whether the link was PAID. A
 * payment whose webhook is late or lost must not be answered with "your link
 * expired" — that cart is logged at error for a human instead.
 *
 * Idempotent: every outcome is stamped on the cart's metadata. A failed email
 * leaves `expiry_notified_at` empty and is retried on the next run.
 */
const MAX_BATCH = Number(process.env.PAYU_LINK_SWEEP_MAX_BATCH || 50)

export default async function expireDesignOrderPayuLinks(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const cartService: any = container.resolve(Modules.CART)

  let rows: any[] = []
  try {
    const result = await pg.raw(
      `select id, email, completed_at, metadata
         from cart
        where deleted_at is null
          and (metadata->'${PAYU_LINK_METADATA_KEY}') is not null
          and (
                (metadata->'${PAYU_LINK_METADATA_KEY}'->>'closed_at') is null
             or ( (metadata->'${PAYU_LINK_METADATA_KEY}'->>'closed_reason') = 'expired'
                  and (metadata->'${PAYU_LINK_METADATA_KEY}'->>'expiry_notified_at') is null )
          )
          and (
                completed_at is not null
             or (metadata->>'cancelled_at') is not null
             or (metadata->'${PAYU_LINK_METADATA_KEY}'->>'expires_at')::timestamptz <= now()
          )
        order by updated_at asc
        limit ?`,
      [MAX_BATCH]
    )
    rows = result?.rows ?? []
  } catch (e: any) {
    logger.error(`[payu-link-sweep] query failed: ${e?.message ?? e}`)
    return
  }

  if (!rows.length) return

  const now = new Date()
  let closed = 0
  let notified = 0
  let held = 0

  for (const cart of rows) {
    const link = readTrackedLink(cart.metadata)
    const to = String(cart.email ?? "").trim() || null
    const action = decideLinkSweep({
      link,
      completedAt: cart.completed_at,
      cancelledAt: cart.metadata?.cancelled_at,
      hasEmail: Boolean(to),
      now,
    })
    if (action.kind === "skip" || !link) continue

    const stamp = async (patch: Partial<TrackedPayuLink>) => {
      // Re-read so we never overwrite a link minted since this run's query.
      const [fresh] = await cartService.listCarts({ id: cart.id }, { select: ["id", "metadata"] })
      const current = readTrackedLink(fresh?.metadata)
      if (!current || current.invoice_number !== link.invoice_number) return false
      await cartService.updateCarts(cart.id, {
        metadata: {
          ...(fresh?.metadata ?? {}),
          [PAYU_LINK_METADATA_KEY]: { ...current, ...patch },
        },
      })
      return true
    }

    try {
      let notify = action.kind === "notify_only"

      if (action.kind === "close") {
        if (action.reason === "expired") {
          const paid = await verifyBalanceLinkViaOneApi(link.invoice_number).catch(() => null)
          if (paid === null) {
            // Can't tell — PayU unreachable or not configured. Do nothing; retry.
            logger.warn(
              `[payu-link-sweep] could not check link ${link.invoice_number} (cart ${cart.id}) with PayU; will retry`
            )
            held++
            continue
          }
          if (paid.paid) {
            logger.error(
              `[payu-link-sweep] link ${link.invoice_number} on cart ${cart.id} is PAID at PayU ` +
                `(txn ${paid.transaction_id}) but the cart is not completed — check the PayU webhook. No expiry email sent.`
            )
            await stamp({ closed_at: now.toISOString(), closed_reason: "paid" })
            held++
            continue
          }
        }

        const off = await deactivatePayuLink(link.invoice_number)
        if (!off.ok) {
          logger.warn(
            `[payu-link-sweep] could not switch off ${link.invoice_number} (cart ${cart.id}): ${off.error}; will retry`
          )
          held++
          continue
        }
        await stamp({ closed_at: now.toISOString(), closed_reason: action.reason })
        closed++
        notify = action.notify
      }

      if (notify && to) {
        const { result } = await sendDesignOrderPaymentExpiredEmailWorkflow(container).run({
          input: {
            to,
            data: {
              cart_id: cart.id,
              checkout_url: `${(process.env.MEDUSA_BACKEND_URL || "https://v3.jaalyantra.com").replace(/\/+$/, "")}/r/cart/${cart.id}`,
              expired_at: formatExpiryForBuyer(new Date(link.expires_at)),
              current_year: `${now.getFullYear()}`,
            },
          },
        })
        if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
          // Suppressed recipient: stamp so we don't retry forever, but say so.
          logger.warn(`[payu-link-sweep] expiry email suppressed for cart ${cart.id} (${to})`)
        }
        await stamp({ expiry_notified_at: new Date().toISOString() })
        notified++
      }
    } catch (e: any) {
      logger.error(`[payu-link-sweep] cart ${cart.id} failed: ${e?.message ?? e}`)
    }
  }

  logger.info(
    `[payu-link-sweep] done — closed=${closed} notified=${notified} held=${held} of ${rows.length}`
  )
}

export const config = {
  name: "expire-design-order-payu-links",
  schedule: "*/30 * * * *",
}
