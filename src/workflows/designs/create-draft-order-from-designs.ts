import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/framework/link"
import { DESIGN_MODULE } from "../../modules/designs"
import {
  estimateDesignCostWorkflow,
  EstimateCostOutput,
} from "./estimate-design-cost"

// ─── Types ───────────────────────────────────────────────────────────────────

type CreateDraftOrderFromDesignsInput = {
  customer_id: string
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
}

type DesignEstimate = {
  design_id: string
  name: string
  unit_price: number
  confidence: string
}

// ─── Step 1: Estimate costs for each design ──────────────────────────────────

const estimateDesignCostsStep = createStep(
  "estimate-design-costs-step",
  async (
    input: { design_ids: string[]; price_overrides?: Record<string, number> },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const overrides = input.price_overrides || {}

    const estimates: DesignEstimate[] = []

    for (const design_id of input.design_ids) {
      const { data: designs } = await query.graph({
        entity: "design",
        filters: { id: design_id },
        fields: ["id", "name"],
      })

      const design = designs?.[0]
      if (!design) {
        throw new Error(`Design not found: ${design_id}`)
      }

      if (design_id in overrides) {
        estimates.push({
          design_id,
          name: design.name,
          unit_price: overrides[design_id],
          confidence: "manual",
        })
      } else {
        const { result: costEstimate } = await estimateDesignCostWorkflow(
          container
        ).run({ input: { design_id } }) as { result: EstimateCostOutput }

        estimates.push({
          design_id,
          name: design.name,
          unit_price: Math.round(costEstimate.total_estimated * 100),
          confidence: costEstimate.confidence,
        })
      }
    }

    return new StepResponse({ estimates })
  }
)

// ─── Step 2: Create draft order ──────────────────────────────────────────────

const createDraftOrderStep = createStep(
  "create-draft-order-step",
  async (
    input: {
      customer_id: string
      currency_code?: string
      estimates: DesignEstimate[]
    },
    { container }
  ) => {
    const orderModuleService = container.resolve(Modules.ORDER)

    const currencyCode = input.currency_code || "inr"

    const items = input.estimates.map((est) => ({
      title: est.name,
      quantity: 1,
      unit_price: est.unit_price,
      metadata: {
        design_id: est.design_id,
        cost_confidence: est.confidence,
      },
    }))

    const order = await (orderModuleService as any).createOrders({
      status: "draft",
      currency_code: currencyCode,
      customer_id: input.customer_id,
      items,
    })

    return new StepResponse(order, order.id)
  },
  async (orderId, { container }) => {
    if (!orderId) return
    const orderModuleService = container.resolve(Modules.ORDER)
    await (orderModuleService as any).deleteOrders(orderId)
  }
)

// ─── Step 3: Link designs to the order ───────────────────────────────────────

const linkDesignsToOrderStep = createStep(
  "link-designs-to-order-step",
  async (
    input: { design_ids: string[]; order_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const links = input.design_ids.map((design_id) => ({
      [DESIGN_MODULE]: { design_id },
      [Modules.ORDER]: { order_id: input.order_id },
    }))

    await remoteLink.create(links)

    return new StepResponse(null, input)
  },
  async (input, { container }) => {
    if (!input) return
    const remoteLink = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const links = input.design_ids.map((design_id) => ({
      [DESIGN_MODULE]: { design_id },
      [Modules.ORDER]: { order_id: input.order_id },
    }))

    await remoteLink.dismiss(links)
  }
)

// ─── Step 4: Delink designs from customer ────────────────────────────────────

const delinkDesignsFromCustomerStep = createStep(
  "delink-designs-from-customer-step",
  async (
    input: { design_ids: string[]; customer_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const links = input.design_ids.map((design_id) => ({
      [DESIGN_MODULE]: { design_id },
      [Modules.CUSTOMER]: { customer_id: input.customer_id },
    }))

    await remoteLink.dismiss(links)

    return new StepResponse(null, input)
  },
  async (input, { container }) => {
    // Compensation: re-link designs back to customer
    if (!input) return
    const remoteLink = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const links = input.design_ids.map((design_id) => ({
      [DESIGN_MODULE]: { design_id },
      [Modules.CUSTOMER]: { customer_id: input.customer_id },
    }))

    await remoteLink.create(links)
  }
)

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const createDraftOrderFromDesignsWorkflow = createWorkflow(
  "create-draft-order-from-designs",
  (input: CreateDraftOrderFromDesignsInput) => {
    const estimatesResult = estimateDesignCostsStep({
      design_ids: input.design_ids,
      price_overrides: input.price_overrides,
    })

    const order = createDraftOrderStep({
      customer_id: input.customer_id,
      currency_code: input.currency_code,
      estimates: estimatesResult.estimates as unknown as DesignEstimate[],
    })

    linkDesignsToOrderStep({
      design_ids: input.design_ids,
      order_id: order.id,
    })

    delinkDesignsFromCustomerStep({
      design_ids: input.design_ids,
      customer_id: input.customer_id,
    })

    return new WorkflowResponse(order)
  }
)

export default createDraftOrderFromDesignsWorkflow
