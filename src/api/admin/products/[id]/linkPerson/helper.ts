import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const refetchProduct = async (
  id: string,
  container: MedusaContainer,
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: product } = await query.graph({
    entity: "products",
    filters: { id },
    fields: [
      "people.*",
      "designs.*",
      "designs.partners.*",
      "designs.partners.people.*",
    ],
  })

  return product[0]
}
