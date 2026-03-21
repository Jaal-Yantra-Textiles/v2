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
          unit_price: costEstimate.total_estimated,
          confidence: costEstimate.confidence,
        })
      }
    }

    return new StepResponse({ estimates })
  }
)

// ─── Step 2: Create cart with design line items ──────────────────────────────

const createDesignCartStep = createStep(
  "create-design-cart-step",
  async (
    input: {
      customer_id: string
      currency_code?: string
      estimates: DesignEstimate[]
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const cartService = container.resolve(Modules.CART) as any

    const currencyCode = input.currency_code || "inr"

    // Find a region that supports this currency
    const { data: regions } = await query.graph({
      entity: "region",
      filters: {},
      fields: ["id", "currency_code"],
    })

    const region = regions?.find(
      (r: any) => r.currency_code === currencyCode
    ) || regions?.[0]

    if (!region) {
      throw new Error("No region found for cart creation")
    }

    // Find the default sales channel from the store
    const { data: stores } = await query.graph({
      entity: "store",
      filters: {},
      fields: ["id", "default_sales_channel_id"],
    })

    let salesChannelId = stores?.[0]?.default_sales_channel_id

    if (!salesChannelId) {
      // Fallback: find any sales channel
      const { data: salesChannels } = await query.graph({
        entity: "sales_channel",
        filters: {},
        fields: ["id"],
      })
      if (!salesChannels?.length) {
        throw new Error("No sales channel found for cart creation")
      }
      salesChannelId = salesChannels[0].id
    }

    // Find the customer's email
    const { data: customers } = await query.graph({
      entity: "customer",
      filters: { id: input.customer_id },
      fields: ["id", "email"],
    })
    const customerEmail = customers?.[0]?.email

    // Create the cart
    const cart = await cartService.createCarts({
      region_id: region.id,
      currency_code: currencyCode,
      customer_id: input.customer_id,
      email: customerEmail,
      sales_channel_id: salesChannelId,
      metadata: {
        created_by: "admin",
        source: "design-order",
      },
    })

    // Add custom-priced line items for each design
    const lineItems = await cartService.addLineItems(
      cart.id,
      input.estimates.map((est) => ({
        title: est.name,
        unit_price: est.unit_price,
        is_custom_price: true,
        quantity: 1,
        metadata: {
          design_id: est.design_id,
          cost_confidence: est.confidence,
        },
      }))
    )

    return new StepResponse(
      { cart, lineItems },
      cart.id
    )
  },
  async (cartId, { container }) => {
    if (!cartId) return
    const cartService = container.resolve(Modules.CART) as any
    try {
      await cartService.deleteCarts(cartId)
    } catch {
      // Cart may have been completed already
    }
  }
)

// ─── Step 3: Link designs to cart line items ─────────────────────────────────

const linkDesignsToLineItemsStep = createStep(
  "link-designs-to-line-items-step",
  async (
    input: {
      estimates: DesignEstimate[]
      lineItems: any[]
    },
    { container }
  ) => {
    const remoteLink = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const links: any[] = []
    for (let i = 0; i < input.estimates.length; i++) {
      const lineItem = input.lineItems[i]
      if (lineItem) {
        links.push({
          [DESIGN_MODULE]: { design_id: input.estimates[i].design_id },
          [Modules.CART]: { line_item_id: lineItem.id },
        })
      }
    }

    if (links.length > 0) {
      await remoteLink.create(links)
    }

    return new StepResponse(
      null,
      links
    )
  },
  async (links, { container }) => {
    if (!links || links.length === 0) return
    const remoteLink = container.resolve<Link>(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
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

    const cartResult = createDesignCartStep({
      customer_id: input.customer_id,
      currency_code: input.currency_code,
      estimates: estimatesResult.estimates as unknown as DesignEstimate[],
    })

    linkDesignsToLineItemsStep({
      estimates: estimatesResult.estimates as unknown as DesignEstimate[],
      lineItems: cartResult.lineItems,
    })

    return new WorkflowResponse(cartResult.cart)
  }
)

export default createDraftOrderFromDesignsWorkflow
