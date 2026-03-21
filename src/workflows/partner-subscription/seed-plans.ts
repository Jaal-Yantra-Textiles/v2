import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PARTNER_PLAN_MODULE } from "../../modules/partner-plan"
import PartnerPlanService from "../../modules/partner-plan/service"
import { PlanInterval } from "../../modules/partner-plan/types"

const DEFAULT_PLANS = [
  {
    name: "Starter",
    slug: "starter",
    description:
      "Everything you need to start selling. Unlimited products, staff, and storefront — pay only when you earn.",
    price: 0,
    currency_code: "inr",
    interval: PlanInterval.MONTHLY,
    sort_order: 0,
    is_active: true,
    features: {
      unlimited_products: true,
      unlimited_staff: true,
      unlimited_selling: true,
      storefront_source_code: true,
      jyt_emails: true,
      custom_domain: true,
      theme_customization: "full",
      live_shipping: true,
      shipping_partners: ["delhivery", "dhl", "ups", "fedex", "auspost"],
      payment_processing_fee: "4%",
      payment_gateways: ["payu", "stripe"],
      analytics: "basic",
      ai_chat_support: false,
      custom_modules: false,
      custom_apis: false,
      priority_support: false,
      white_label: false,
    },
  },
  {
    name: "Growth",
    slug: "growth",
    description:
      "For scaling brands. Lower fees, AI support, and advanced analytics to grow faster.",
    price: 1999,
    currency_code: "inr",
    interval: PlanInterval.MONTHLY,
    sort_order: 1,
    is_active: true,
    features: {
      unlimited_products: true,
      unlimited_staff: true,
      unlimited_selling: true,
      storefront_source_code: true,
      jyt_emails: true,
      custom_domain: true,
      theme_customization: "full",
      live_shipping: true,
      shipping_partners: ["delhivery", "dhl", "ups", "fedex", "auspost"],
      payment_processing_fee: "2%",
      payment_gateways: ["payu", "stripe"],
      analytics: "advanced",
      ai_chat_support: true,
      custom_modules: false,
      custom_apis: false,
      priority_support: true,
      white_label: false,
    },
  },
  {
    name: "Enterprise",
    slug: "enterprise",
    description:
      "Full platform access. Custom modules, APIs, white-label, and dedicated support for large operations.",
    price: 9999,
    currency_code: "inr",
    interval: PlanInterval.MONTHLY,
    sort_order: 2,
    is_active: true,
    features: {
      unlimited_products: true,
      unlimited_staff: true,
      unlimited_selling: true,
      storefront_source_code: true,
      jyt_emails: true,
      custom_domain: true,
      theme_customization: "full",
      live_shipping: true,
      shipping_partners: ["delhivery", "dhl", "ups", "fedex", "auspost"],
      payment_processing_fee: "1%",
      payment_gateways: ["payu", "stripe", "custom"],
      analytics: "advanced",
      ai_chat_support: true,
      custom_modules: true,
      custom_apis: true,
      priority_support: true,
      white_label: true,
    },
  },
]

type SeedResult = {
  plans: any[]
  created: number
  created_ids: string[]
}

const seedPlansStep = createStep(
  "seed-partner-plans-step",
  async (_: void, { container }) => {
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

    const [existing] = await service.listAndCountPartnerPlans({}, { take: 100 })
    const existingSlugs = new Set(existing.map((p: any) => p.slug))

    const toCreate = DEFAULT_PLANS.filter((p) => !existingSlugs.has(p.slug))

    if (toCreate.length === 0) {
      return new StepResponse<SeedResult, SeedResult>({
        plans: existing,
        created: 0,
        created_ids: [],
      })
    }

    const createdIds: string[] = []
    for (const plan of toCreate) {
      const created = await service.createPartnerPlans(plan)
      createdIds.push((created as any).id)
    }

    const [allPlans] = await service.listAndCountPartnerPlans({}, { take: 100 })

    return new StepResponse<SeedResult, SeedResult>(
      { plans: allPlans, created: toCreate.length, created_ids: createdIds },
      { plans: allPlans, created: toCreate.length, created_ids: createdIds }
    )
  },
  async (data, { container }) => {
    if (!data || !data.created_ids?.length) return
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)
    await service.deletePartnerPlans(data.created_ids)
  }
)

export const seedPartnerPlansWorkflow = createWorkflow(
  "seed-partner-plans",
  () => {
    const result = seedPlansStep()
    return new WorkflowResponse(result)
  }
)
