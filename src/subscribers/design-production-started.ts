import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendDesignStatusUpdateEmailWorkflow } from "../workflows/email"

export default async function designProductionStartedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ design_id: string; production_run_id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: data.design_id },
      fields: ["id", "name", "status", "metadata"],
    })

    const design = designs?.[0]
    if (!design) return

    const designUrl = design.metadata?.base_product_handle
      ? `${process.env.STORE_URL || ""}/products/${design.metadata.base_product_handle}/design?designId=${design.id}`
      : undefined

    await sendDesignStatusUpdateEmailWorkflow(container).run({
      input: {
        designId: design.id,
        designName: design.name,
        templateKey: "design-production-started",
        designStatus: "In Production",
        designUrl,
        extraData: {
          production_run_id: data.production_run_id,
        },
      },
    })
  } catch (error) {
    logger.warn(
      `[design.production_started] Failed to send notification for design ${data.design_id}: ${(error as any)?.message || error}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "design.production_started",
}
