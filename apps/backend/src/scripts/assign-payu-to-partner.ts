import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Assigns PayU payment provider to all INR regions.
 *
 * Usage:
 *   npx medusa exec src/scripts/assign-payu-to-partner.ts
 */
export default async function assignPayUToPartner({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK) as any

  // Check if PayU provider exists
  const { data: providers } = await query.graph({
    entity: "payment_provider",
    fields: ["id", "is_enabled"],
  })

  const payuProvider = (providers || []).find((p: any) => p.id === "pp_payu_payu")

  if (!payuProvider) {
    logger.error("PayU provider (pp_payu_payu) not found. Make sure PAYU_MERCHANT_KEY is set.")
    return
  }

  logger.info(`Found PayU provider: ${payuProvider.id}`)

  // Find INR regions
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })

  const inrRegions = (regions || []).filter(
    (r: any) => r.currency_code === "inr"
  )

  if (!inrRegions.length) {
    logger.warn("No INR regions found.")
    logger.info("Available regions:")
    for (const r of (regions || [])) {
      logger.info(`  ${(r as any).id} | ${(r as any).name} | ${(r as any).currency_code}`)
    }
    return
  }

  for (const region of inrRegions) {
    const r = region as any

    // Check if already linked via remoteQuery
    try {
      const existingLinks = await query.graph({
        entity: "region",
        fields: ["payment_providers.id"],
        filters: { id: r.id },
      })

      const linkedProviders = ((existingLinks.data?.[0] as any)?.payment_providers || []).map((p: any) => p.id)

      if (linkedProviders.includes("pp_payu_payu")) {
        logger.info(`Region "${r.name}" (${r.id}) already has PayU.`)
        continue
      }

      // Create link between region and payment provider
      await remoteLink.create({
        [Modules.REGION]: { region_id: r.id },
        [Modules.PAYMENT]: { payment_provider_id: "pp_payu_payu" },
      })

      logger.info(`Assigned PayU to region "${r.name}" (${r.id})`)
    } catch (e: any) {
      logger.error(`Failed for region "${r.name}": ${e.message}`)
    }
  }

  logger.info("Done.")
}
