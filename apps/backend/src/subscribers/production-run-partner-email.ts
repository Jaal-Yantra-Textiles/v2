import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendPartnerProductionRunEmailWorkflow } from "../workflows/email/workflows/send-partner-production-run-email"
import {
  resolvePartnerProductionRunTemplateKey,
  type ProductionRunEmailAction,
} from "../workflows/email/workflows/partner-production-run-email-lib"

/**
 * #576 slice B — email the owning partner's active admins when a production run
 * is completed or cancelled. Runs alongside the feed-only
 * production-run-notifications subscriber.
 *
 * partner_id may be absent from the event payload (the admin cancel route emits
 * production_run.cancelled without it) — the workflow resolves the partner from
 * the run itself. Best-effort: a missing template/partner is logged + skipped,
 * never thrown, so the lifecycle event handler is unaffected.
 */
export default async function productionRunPartnerEmailHandler({
  event,
  container,
}: SubscriberArgs<{
  id: string
  production_run_id?: string
  partner_id?: string
  action?: string
  notes?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const data = event.data
  if (!data) return

  const productionRunId = data.production_run_id || data.id
  if (!productionRunId) return

  // Derive the lifecycle action from the payload or the event suffix.
  const action = (data.action ||
    event.name?.split(".").pop() ||
    "") as ProductionRunEmailAction
  if (!resolvePartnerProductionRunTemplateKey(action)) {
    return
  }

  try {
    await sendPartnerProductionRunEmailWorkflow(container).run({
      input: {
        productionRunId,
        partnerId: data.partner_id,
        action,
        notes: data.notes,
      },
    })
  } catch (e: any) {
    logger.warn(
      `[production_run.${action}] Partner email failed for run ${productionRunId}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["production_run.completed", "production_run.cancelled"],
}
