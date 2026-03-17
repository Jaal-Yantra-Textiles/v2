import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PARTNER_PLAN_MODULE } from "../../modules/partner-plan"
import PartnerPlanService from "../../modules/partner-plan/service"

const DEFAULT_PLANS = [
  {
    name: "Simple",
    slug: "simple",
    description: "Free plan with essential features to get started",
    price: 0,
    currency_code: "inr",
    interval: "monthly",
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
    interval: "monthly",
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
    interval: "monthly",
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

const seedPlansStep = createStep(
  "seed-partner-plans-step",
  async (_input: Record<string, never>, { container }) => {
    const service: PartnerPlanService = container.resolve(PARTNER_PLAN_MODULE)

    const [existing] = await service.listAndCountPartnerPlans({}, { take: 100 })
    const existingSlugs = new Set(existing.map((p: any) => p.slug))

    const toCreate = DEFAULT_PLANS.filter((p) => !existingSlugs.has(p.slug))

    if (toCreate.length === 0) {
      return new StepResponse({ plans: existing, created: 0 })
    }

    const created = await service.createPartnerPlans(toCreate)

    return new StepResponse(
      { plans: [...existing, ...created], created: created.length },
      { created_ids: created.map((p: any) => p.id) }
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
    const result = seedPlansStep({})
    return new WorkflowResponse(result)
  }
)
