import { Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * Sends admin feed notifications when production run milestones are reached.
 * Listens to events emitted by the production run action endpoints.
 */
export default async function productionRunNotificationHandler({
  event,
  container,
}: SubscriberArgs<{
  id: string
  production_run_id?: string
  partner_id?: string
  design_id?: string
  status?: string
  action?: string
  notes?: string
}>) {
  const data = event.data
  if (!data) return

  const runId = data.production_run_id || data.id
  if (!runId) return

  const action = data.action || event.name?.split(".").pop() || "unknown"

  // Build notification message based on action
  let title = "Production Run Update"
  let description = `Production run ${runId}`

  switch (action) {
    case "accepted":
      title = "Production Run Accepted"
      description = `Partner accepted production run ${runId}. Work can begin.`
      break
    case "started":
      title = "Production Run Started"
      description = `Partner started working on production run ${runId}.`
      break
    case "finished":
      title = "Production Run Finished — Review Required"
      description = `Partner marked production run ${runId} as finished.${data.notes ? ` Notes: "${data.notes}"` : ""} Design moved to Revision for review.`
      break
    case "completed":
      title = "Production Run Completed"
      description = `Partner completed production run ${runId}.${data.notes ? ` Notes: "${data.notes}"` : ""}`
      break
    case "cancelled":
      title = "Production Run Cancelled"
      description = `Production run ${runId} was cancelled.${data.notes ? ` Reason: "${data.notes}"` : ""}`
      break
    default:
      description = `Production run ${runId} — ${action}`
  }

  try {
    const notificationService = container.resolve(Modules.NOTIFICATION) as any
    await notificationService.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: { title, description },
    })
  } catch (e: any) {
    console.error("[production-run-notifications] Failed to send notification:", e.message)
  }
}

export const config: SubscriberConfig = {
  event: [
    "production_run.accepted",
    "production_run.started",
    "production_run.finished",
    "production_run.completed",
    "production_run.cancelled",
  ],
}
