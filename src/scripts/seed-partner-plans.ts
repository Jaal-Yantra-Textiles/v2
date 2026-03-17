import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNER_PLAN_MODULE } from "../modules/partner-plan"
import PartnerPlanService from "../modules/partner-plan/service"
import { PlanInterval } from "../modules/partner-plan/types"

const DEFAULT_PLANS = [
  {
    name: "Simple",
    slug: "simple",
    description: "Free plan with essential features to get started",
    price: 0,
    currency_code: "inr",
    interval: PlanInterval.MONTHLY,
    sort_order: 0,
    is_active: true,
    features: {
      max_pages: 5,
      max_products: 50,
      custom_domain: false,
      theme_customization: "basic",
      analytics: false,
      priority_support: false,
    },
  },
  {
    name: "Pro",
    slug: "pro",
    description: "For growing businesses with advanced features",
    price: 2000,
    currency_code: "inr",
    interval: PlanInterval.MONTHLY,
    sort_order: 1,
    is_active: true,
    features: {
      max_pages: 50,
      max_products: 500,
      custom_domain: true,
      theme_customization: "full",
      analytics: true,
      priority_support: false,
    },
  },
  {
    name: "Max",
    slug: "max",
    description: "Unlimited access with premium support",
    price: 5000,
    currency_code: "inr",
    interval: PlanInterval.MONTHLY,
    sort_order: 2,
    is_active: true,
    features: {
      max_pages: -1,
      max_products: -1,
      custom_domain: true,
      theme_customization: "full",
      analytics: true,
      priority_support: true,
    },
  },
]

export default async function seedPartnerPlans({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

  logger.info("Seeding partner plans...")

  const [existing] = await service.listAndCountPartnerPlans({}, { take: 100 })
  const existingSlugs = new Set(existing.map((p: any) => p.slug))

  let created = 0

  for (const plan of DEFAULT_PLANS) {
    if (existingSlugs.has(plan.slug)) {
      logger.info(`  Plan "${plan.name}" already exists, skipping.`)
      continue
    }

    await service.createPartnerPlans([plan])
    logger.info(`  Created plan "${plan.name}" (${plan.price} ${plan.currency_code}/${plan.interval})`)
    created++
  }

  logger.info(`Partner plans seeded. Created: ${created}, Existing: ${existing.length}`)
}
