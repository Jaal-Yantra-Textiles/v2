import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { promoteDesignToProductWorkflow } from "../workflows/designs/promote-design-to-product"
import { sendDesignStatusUpdateEmailWorkflow } from "../workflows/email"

/** Statuses that warrant a customer notification */
const NOTIFY_STATUSES = new Set([
  "In_Development",
  "Technical_Review",
  "Sample_Production",
  "Approved",
  "Commerce_Ready",
])

export default async function designCommerceReadyHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; previous_status?: string }>) {
  const { id: design_id } = data
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: design_id },
    fields: ["id", "name", "status", "metadata"],
  })

  const design = designs?.[0]
  if (!design) return

  // Promote to product when Commerce_Ready
  if (design.status === "Commerce_Ready") {
    await promoteDesignToProductWorkflow(container).run({
      input: { design_id },
    })
  }

  // Send customer notification for meaningful status transitions
  if (NOTIFY_STATUSES.has(design.status)) {
    try {
      const designUrl = design.metadata?.base_product_handle
        ? `${process.env.STORE_URL || ""}/products/${design.metadata.base_product_handle}/design?designId=${design.id}`
        : undefined

      await sendDesignStatusUpdateEmailWorkflow(container).run({
        input: {
          designId: design.id,
          designName: design.name,
          templateKey: "design-status-updated",
          designStatus: design.status,
          previousStatus: data.previous_status,
          designUrl,
        },
      })
    } catch (error) {
      logger.warn(
        `[design.updated] Failed to send status update email for design ${design_id}: ${(error as any)?.message || error}`
      )
    }
  }
}

export const config: SubscriberConfig = {
  event: "design.updated",
}
