import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendDesignStatusUpdateEmailWorkflow } from "../workflows/email"

export default async function designInventoryLinkedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ design_id: string; inventory_count: number }>) {
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
        templateKey: "design-inventory-linked",
        designStatus: design.status,
        designUrl,
        extraData: {
          inventory_count: data.inventory_count,
        },
      },
    })
  } catch (error) {
    logger.warn(
      `[design.inventory_linked] Failed to send notification for design ${data.design_id}: ${(error as any)?.message || error}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "design.inventory_linked",
}
