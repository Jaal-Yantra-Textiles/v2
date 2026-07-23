import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"
import { sendOrderConfirmationWorkflow } from "../workflows/email/workflows/send-order-confirmation-email"

/**
 * One-off ops job: re-send the customer order-confirmation email for one or
 * more orders by re-running `sendOrderConfirmationWorkflow`.
 *
 * Why this and not the /admin/notifications/:id/retry endpoint: the maileroo
 * provider sends `data._template_html_content` VERBATIM (it does not re-render
 * from the DB template), so a bare retry with flat vars would send
 * "No content available". Re-running the workflow rebuilds the flat vars +
 * partner context from the order and renders the current DB template — so once
 * `update-email-templates.ts` has refreshed the `order-placed` template, this
 * produces the correct, partner-branded email.
 *
 * Usage (prod ships transpiled JS — .js via ECS run-task):
 *   ORDER_IDS=order_01KXWHFP132AM0H940WFD2P0XW \
 *     npx medusa exec ./src/scripts/resend-order-confirmation.ts
 *   ORDER_IDS=order_a,order_b DRY_RUN=1 \
 *     npx medusa exec ./src/scripts/resend-order-confirmation.ts
 */
export default async function resendOrderConfirmation({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const dryRun = process.env.DRY_RUN === "1"
  const orderIds = (process.env.ORDER_IDS || process.env.ORDER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (!orderIds.length) {
    logger.error(
      "[resend-order-confirmation] ORDER_IDS (comma-separated) is required"
    )
    return
  }

  logger.info(
    `[resend-order-confirmation] ${orderIds.length} order(s)${dryRun ? " (dry run)" : ""}`
  )

  let sent = 0
  let errors = 0
  for (const orderId of orderIds) {
    if (dryRun) {
      logger.info(`[resend-order-confirmation] would resend for ${orderId}`)
      sent++
      continue
    }
    try {
      await sendOrderConfirmationWorkflow(container).run({
        input: { orderId },
      })
      logger.info(`[resend-order-confirmation] resent for ${orderId}`)
      sent++
    } catch (e: any) {
      errors++
      logger.error(
        `[resend-order-confirmation] failed for ${orderId}: ${e?.message ?? e}`
      )
    }
  }

  logger.info(
    `[resend-order-confirmation] done — ${sent} ${dryRun ? "would be " : ""}sent, ${errors} error(s)`
  )
}
