import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { promoteDesignToProductWorkflow } from "../workflows/designs/promote-design-to-product"

export default async function designCommerceReadyHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const { id: design_id } = data

  // Fetch the current design status
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: design_id },
    fields: ["id", "status"],
  })

  const design = designs?.[0]
  if (!design) return

  // Only proceed for Commerce_Ready status
  if (design.status !== "Commerce_Ready") return

  await promoteDesignToProductWorkflow(container).run({
    input: { design_id },
  })
}

export const config: SubscriberConfig = {
  event: "design.updated",
}
