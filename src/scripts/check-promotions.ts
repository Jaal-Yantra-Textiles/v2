import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function checkPromotions({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const promotionService = container.resolve(Modules.PROMOTION) as any

  logger.info("Checking for automatic promotions...")

  const [promos, count] = await promotionService.listAndCountPromotions(
    { is_automatic: true },
    { take: 100, relations: ["rules", "application_method", "application_method.target_rules", "application_method.buy_rules"] }
  )

  logger.info(`Found ${count} automatic promotion(s)`)

  for (const promo of promos) {
    logger.info(`\n--- Promotion: ${promo.code} (${promo.id}) ---`)
    logger.info(`  Status: ${promo.status}, Type: ${promo.type}`)
    logger.info(`  Rules: ${JSON.stringify(promo.rules?.map((r: any) => ({ attr: r.attribute, op: r.operator, values: r.values })), null, 2)}`)
    if (promo.application_method) {
      const am = promo.application_method
      logger.info(`  App Method: type=${am.type}, target=${am.target_type}, value=${am.value}`)
      if (am.target_rules?.length) {
        logger.info(`  Target Rules: ${JSON.stringify(am.target_rules.map((r: any) => ({ attr: r.attribute, op: r.operator })), null, 2)}`)
      }
      if (am.buy_rules?.length) {
        logger.info(`  Buy Rules: ${JSON.stringify(am.buy_rules.map((r: any) => ({ attr: r.attribute, op: r.operator })), null, 2)}`)
      }
    }
  }

  if (count > 0) {
    logger.info(`\n⚠️  Automatic promotions with dotted attribute names (like region.id, items.product.id) cause a SQL bug in @medusajs/promotion.`)
    logger.info(`To fix cart 500 errors, disable these promotions or set is_automatic=false.`)
  } else {
    logger.info(`No automatic promotions found.`)
  }
}
