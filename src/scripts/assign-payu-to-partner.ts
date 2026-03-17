import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Assigns PayU payment provider to a partner's INR region.
 *
 * Usage:
 *   npx medusa exec src/scripts/assign-payu-to-partner.ts -- --partner <handle>
 *
 * If no --partner flag, assigns to all INR regions.
 */
export default async function assignPayUToPartner({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const regionService = container.resolve(Modules.REGION) as any

  // Check if PayU provider exists
  const { data: providers } = await query.graph({
    entity: "payment_provider",
    fields: ["id", "is_enabled"],
  })

  const payuProvider = (providers || []).find((p: any) => p.id === "pp_payu_payu")

  if (!payuProvider) {
    logger.error("PayU provider (pp_payu_payu) not found. Make sure PAYU_MERCHANT_KEY is set and the app has been restarted.")
    return
  }

  logger.info(`Found PayU provider: ${payuProvider.id}`)

  // Find INR regions
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "payment_providers.id"],
  })

  const inrRegions = (regions || []).filter(
    (r: any) => r.currency_code === "inr"
  )

  if (!inrRegions.length) {
    logger.warn("No INR regions found. Create an India region first.")

    // List all regions for reference
    logger.info("Available regions:")
    for (const r of (regions || [])) {
      const providerIds = ((r as any).payment_providers || []).map((p: any) => p.id).join(", ")
      logger.info(`  ${(r as any).id} | ${(r as any).name} | ${(r as any).currency_code} | providers: ${providerIds || "none"}`)
    }
    return
  }

  for (const region of inrRegions) {
    const r = region as any
    const existingProviders = (r.payment_providers || []).map((p: any) => p.id)

    if (existingProviders.includes("pp_payu_payu")) {
      logger.info(`Region "${r.name}" (${r.id}) already has PayU assigned.`)
      continue
    }

    try {
      // Add PayU to region's payment providers
      const updatedProviders = [...existingProviders, "pp_payu_payu"]
      await regionService.updateRegions({
        id: r.id,
        payment_providers: updatedProviders,
      })
      logger.info(`Assigned PayU to region "${r.name}" (${r.id}). Providers: ${updatedProviders.join(", ")}`)
    } catch (e: any) {
      logger.error(`Failed to assign PayU to region "${r.name}": ${e.message}`)
    }
  }

  logger.info("Done.")
}
