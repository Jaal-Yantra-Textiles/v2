import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function testCartCreate({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const promotionService = container.resolve(Modules.PROMOTION) as any

  // 1. Check all promotions (not just automatic)
  logger.info("=== ALL PROMOTIONS ===")
  const [allPromos] = await promotionService.listAndCountPromotions(
    {},
    { take: 100 }
  )
  logger.info(`Total promotions: ${allPromos.length}`)
  for (const p of allPromos) {
    logger.info(`  ${p.code} | status=${p.status} | type=${p.type} | is_automatic=${p.is_automatic}`)
  }

  // 2. Check promotion rules
  logger.info("\n=== PROMOTION RULES ===")
  const { data: rules } = await query.graph({
    entity: "promotion_rule",
    fields: ["*"],
  })
  logger.info(`Total promotion rules: ${rules?.length || 0}`)
  for (const r of (rules || [])) {
    logger.info(`  attr=${(r as any).attribute} | op=${(r as any).operator} | id=${(r as any).id}`)
  }

  // 3. Check promotion rule values
  logger.info("\n=== PROMOTION RULE VALUES ===")
  try {
    const { data: ruleValues } = await query.graph({
      entity: "promotion_rule_value",
      fields: ["*"],
    })
    logger.info(`Total rule values: ${ruleValues?.length || 0}`)
    for (const rv of (ruleValues || [])) {
      logger.info(`  value=${(rv as any).value} | rule_id=${(rv as any).promotion_rule_id}`)
    }
  } catch (e: any) {
    logger.info(`Could not query rule values: ${e.message}`)
  }

  // 4. Check regions
  logger.info("\n=== REGIONS ===")
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })
  for (const r of (regions || [])) {
    logger.info(`  ${(r as any).id} | ${(r as any).name} | ${(r as any).currency_code}`)
  }

  // 5. Try computeActions directly with empty context to see if the SQL breaks
  logger.info("\n=== TESTING computeActions ===")
  try {
    const actions = await promotionService.computeActions(
      [],
      {
        items: [],
        shipping_methods: [],
      }
    )
    logger.info(`computeActions with empty context returned ${actions.length} actions`)
  } catch (e: any) {
    logger.error(`computeActions failed: ${e.message?.substring(0, 200)}`)
  }

  // 6. Try with a real region context
  if (regions?.length) {
    const regionId = (regions[0] as any).id
    logger.info(`\nTesting with region_id: ${regionId}`)
    try {
      const actions = await promotionService.computeActions(
        [],
        {
          items: [],
          shipping_methods: [],
          region_id: regionId,
          currency_code: (regions[0] as any).currency_code,
        }
      )
      logger.info(`computeActions with region context returned ${actions.length} actions`)
    } catch (e: any) {
      logger.error(`computeActions with region failed: ${e.message?.substring(0, 300)}`)
    }
  }

  // 7. Check payment providers
  logger.info("\n=== PAYMENT PROVIDERS ===")
  const { data: providers } = await query.graph({
    entity: "payment_provider",
    fields: ["*"],
  })
  for (const p of (providers || [])) {
    logger.info(`  ${(p as any).id} | is_enabled=${(p as any).is_enabled}`)
  }
}
