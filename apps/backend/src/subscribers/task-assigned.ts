import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { sendPartnerTaskAssignedWorkflow } from "../workflows/email/workflows/send-partner-task-assigned-email"

// Emitted by runTaskAssignmentWorkflow (src/workflows/tasks/run-task-assignment.ts)
// with { task_id, partner_id } when an eventable task is assigned to a partner.
// The `partner-task-assigned` email template already exists/active in prod — this
// subscriber was previously an empty stub, so the email never fired.
export default async function taskAssignedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ task_id: string; partner_id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    await sendPartnerTaskAssignedWorkflow(container).run({
      input: { taskId: data.task_id, partnerId: data.partner_id },
    })
  } catch (e: any) {
    logger.warn(
      `[task_assigned] Partner task notification failed for task ${data?.task_id}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "task_assigned",
}
