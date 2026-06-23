import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendDesignAssignedEmailWorkflow } from "../workflows/email"

export default async function designAssignedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  design_id: string
  customer_id: string
  design_name: string
  design_url?: string
  design_status?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await sendDesignAssignedEmailWorkflow(container).run({
      input: {
        customerId: data.customer_id,
        designName: data.design_name,
        designUrl: data.design_url,
        designStatus: data.design_status,
      },
    })
  } catch (error) {
    logger.error("[design-assigned] Failed to send notification email:", error as Error)
  }
}

export const config: SubscriberConfig = {
  event: "design.assigned",
}
