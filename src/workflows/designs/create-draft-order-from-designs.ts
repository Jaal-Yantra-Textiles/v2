import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
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
  /** Currency of price_overrides (e.g. "inr"). Defaults to store default. */
  override_currency?: string
}

type DesignEstimate = {
  design_id: string
  name: string
  unit_price: number
  confidence: string
  /** Currency this estimate is denominated in (set by estimate step) */
  source_currency?: string
  original_price?: number
  original_currency?: string
}

// ─── Step 1: Estimate costs for each design ──────────────────────────────────

const estimateDesignCostsStep = createStep(
  "estimate-design-costs-step",
  async (
    input: {
      design_ids: string[]
      price_overrides?: Record<string, number>
      override_currency?: string
    },
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
          // Tag with the override currency so the conversion step knows
          source_currency: input.override_currency?.toLowerCase(),
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
          // Estimation results are in store default currency (no tag = use store default)
        })
      }
    }

    return new StepResponse({ estimates })
  }
)

// ─── Step 2: Convert estimates to target currency ───────────────────────────
//
// Fetches live exchange rates from the Frankfurter API (ECB data, free, no key).
// Rates update once per business day. Results are cached in-memory for 1 hour.
//
// Handles two source currencies:
//   - Estimated prices: assumed to be in store default currency
//   - Manual overrides: in override_currency (if provided), else store default

type FrankfurterResponse = {
  base: string
  date: string
  rates: Record<string, number>
}

const frankfurterCache = new Map<string, { rate: number; fetchedAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000

async function fetchExchangeRate(from: string, to: string): Promise<number> {
  const fromUpper = from.toUpperCase()
  const toUpper = to.toUpperCase()

  if (fromUpper === toUpper) return 1

  const cacheKey = `${fromUpper}_${toUpper}`
  const cached = frankfurterCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate
  }

  const url = `https://api.frankfurter.app/latest?from=${fromUpper}&to=${toUpper}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(
      `Failed to fetch exchange rate ${fromUpper}→${toUpper}: ${res.status} ${res.statusText}`
    )
  }

  const data: FrankfurterResponse = await res.json()
  const rate = data.rates[toUpper]

  if (rate == null) {
    throw new Error(`Exchange rate not available for ${fromUpper}→${toUpper}`)
  }

  frankfurterCache.set(cacheKey, { rate, fetchedAt: Date.now() })
  return rate
}

function applyRate(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100
}

const convertEstimateCurrencyStep = createStep(
  "convert-estimate-currency-step",
  async (
    input: {
      estimates: DesignEstimate[]
      target_currency: string
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const targetCurrency = (input.target_currency || "inr").toLowerCase()

    // Determine the store's default (base) currency
    const { data: stores } = await query.graph({
      entity: "store",
      filters: {},
      fields: ["supported_currencies.currency_code", "supported_currencies.is_default"],
    })

    const store = stores?.[0]
    const defaultCurrency = (
      store?.supported_currencies?.find((sc: any) => sc.is_default)?.currency_code ||
      "inr"
    ).toLowerCase()

    // Collect unique source currencies we need rates for
    const sourceCurrencies = new Set<string>()
    for (const est of input.estimates) {
      const src = est.source_currency || defaultCurrency
      if (src !== targetCurrency) {
        sourceCurrencies.add(src)
      }
    }

    // If no conversion needed for any estimate, return as-is
    if (sourceCurrencies.size === 0) {
      return new StepResponse({
        estimates: input.estimates,
        exchange_rate: 1,
        base_currency: defaultCurrency,
        target_currency: targetCurrency,
      })
    }

    // Fetch exchange rates for each unique source currency → target
    const rates: Record<string, number> = {}
    for (const src of sourceCurrencies) {
      rates[src] = await fetchExchangeRate(src, targetCurrency)
    }

    const converted: DesignEstimate[] = input.estimates.map((est) => {
      const srcCurrency = est.source_currency || defaultCurrency
      const rate = rates[srcCurrency] ?? 1

      if (rate === 1 && srcCurrency === targetCurrency) {
        // No conversion needed for this estimate
        return { ...est, source_currency: undefined }
      }

      return {
        ...est,
        original_price: est.unit_price,
        original_currency: srcCurrency,
        unit_price: applyRate(est.unit_price, rate),
        source_currency: undefined,
      }
    })

    return new StepResponse({
      estimates: converted,
      exchange_rate: Object.values(rates)[0] ?? 1,
      base_currency: defaultCurrency,
      target_currency: targetCurrency,
    })
  }
)

// ─── Step 3: Create cart with design line items ──────────────────────────────

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
        requires_shipping: false,
        quantity: 1,
        metadata: {
          design_id: est.design_id,
          cost_confidence: est.confidence,
          ...(est.original_price != null && {
            original_currency: est.original_currency,
            original_amount: est.original_price,
          }),
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

// ─── Step 4: Link designs to cart line items ─────────────────────────────────

const linkDesignsToLineItemsStep = createStep(
  "link-designs-to-line-items-step",
  async (
    input: {
      estimates: DesignEstimate[]
      lineItems: any[]
    },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

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
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
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
      override_currency: input.override_currency,
    })

    // Convert prices from source currency to target currency
    const convertedResult = convertEstimateCurrencyStep({
      estimates: estimatesResult.estimates as unknown as DesignEstimate[],
      target_currency: input.currency_code as unknown as string,
    })

    const cartResult = createDesignCartStep({
      customer_id: input.customer_id,
      currency_code: input.currency_code,
      estimates: convertedResult.estimates as unknown as DesignEstimate[],
    })

    linkDesignsToLineItemsStep({
      estimates: convertedResult.estimates as unknown as DesignEstimate[],
      lineItems: cartResult.lineItems,
    })

    return new WorkflowResponse(cartResult.cart)
  }
)

export default createDraftOrderFromDesignsWorkflow

// ─── Exported for use in store checkout route ────────────────────────────────

export { fetchExchangeRate, applyRate }
