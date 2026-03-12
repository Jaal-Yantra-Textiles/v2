import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendDesignAssignedEmailWorkflow } from "../../../../../workflows/email"
import designCustomerLink from "../../../../../links/design-customer-link"

/**
 * POST /admin/designs/:id/notify-customer
 *
 * Manually sends (or re-sends) the "design assigned" notification email
 * to the customer linked to this design. Useful when the admin wants to
 * remind a customer about a design they haven't opened yet.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch the design with its linked customer
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "name", "status", "metadata"],
  })

  const design = designs?.[0]
  if (!design) {
    res.status(404).json({ message: "Design not found" })
    return
  }

  // Look up the linked customer via the design-customer link
  const { data: links } = await query.graph({
    entity: designCustomerLink.entryPoint,
    filters: { design_id: designId },
    fields: ["customer_id"],
  })

  if (!links?.length) {
    res.status(422).json({
      message: "This design is not linked to any customer. Assign a customer first.",
    })
    return
  }

  const customerId = links[0].customer_id

  const designUrl = design.metadata?.base_product_handle
    ? `${process.env.STORE_URL || "https://cicilabel.com"}/products/${design.metadata.base_product_handle}/design?designId=${designId}`
    : undefined

  await sendDesignAssignedEmailWorkflow(req.scope).run({
    input: {
      customerId,
      designName: design.name,
      designUrl,
      designStatus: design.status,
    },
    throwOnError: true,
  })

  res.status(200).json({
    message: "Notification sent to customer",
    design_id: designId,
    customer_id: customerId,
  })
}
