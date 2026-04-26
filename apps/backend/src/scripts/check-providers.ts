import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function checkProviders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("=== FULFILLMENT PROVIDERS ===")
  const { data: fp } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  })
  for (const p of (fp || [])) {
    logger.info(`  ${(p as any).id} | enabled: ${(p as any).is_enabled}`)
  }

  logger.info("\n=== PAYMENT PROVIDERS ===")
  const { data: pp } = await query.graph({
    entity: "payment_provider",
    fields: ["id", "is_enabled"],
  })
  for (const p of (pp || [])) {
    logger.info(`  ${(p as any).id} | enabled: ${(p as any).is_enabled}`)
  }
}
