import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export const refetchProduct = async (
  id: string,
  container: MedusaContainer,
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: product } = await query.graph({
    entity: "products",
    filters: { id },
    fields: [
      "designs.*"
    ],
  })

  return product[0]
}