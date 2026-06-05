import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Roadmap item 5 follow-up — classify a product into the JYT-managed
 * "textile_over_2500" product_type based on its maximum INR variant
 * price, so the IN tax_region's 18% rule fires correctly at cart time
 * (vs. the 5% default that's correct for sub-₹2,500 items).
 *
 * Why a product-level type and not per-variant:
 * Medusa's `tax_rate_rule.reference` only accepts `product`,
 * `product_type`, or `shipping_option`. A single product carries one
 * `type_id`, so when variants straddle the ₹2,500 threshold we go
 * conservative — use the MAX variant price. That over-collects on
 * cheap variants but never under-collects, which is the right side
 * of statutory tax liability. Documented in
 * `apps/docs/notes/TAX_NOTES.md`.
 *
 * Safe to call repeatedly. Only mutates the product when the resolved
 * tax class differs from the current `type_id` AND the current
 * `type_id` is either NULL or one of the JYT-managed values — never
 * overwrites a partner-assigned type.
 */

// ₹2,500 — INR stored as whole rupees in Medusa 2.x (currency has
// decimal_digits=0), confirmed by the prod /store/products probe
// returning `calculated_amount: 4999` for a ₹4,999 variant.
export const IN_TEXTILE_THRESHOLD_INR = 2500

// The JYT-managed product_type value (stored on
// product_type.value). The seed script `seed-in-textile-tax-class.ts`
// is the only writer that creates rows with these values.
export const TAX_CLASS_OVER_2500_VALUE = "jyt_tax_in_textile_over_2500"

// Set of all type values the classifier owns. Used to decide whether
// it's safe to clear/replace a product's current type_id. Anything
// not in this set is partner-managed and must not be touched.
export const JYT_MANAGED_TAX_CLASS_VALUES = new Set<string>([
  TAX_CLASS_OVER_2500_VALUE,
])

export type ClassifyProductInput = {
  product_id: string
  /**
   * When true, compute the decision (`assigned` / `cleared` /
   * `no-change` / `skipped`) but DO NOT mutate the product's type_id.
   * Used by the backfill's `--dry-run` so a preview is actually a
   * preview. The returned `decision` still reflects what WOULD happen.
   */
  dry_run?: boolean
}

export type ClassifyProductResult = {
  product_id: string
  decision: "assigned" | "cleared" | "no-change" | "skipped"
  reason: string
  max_inr_price: number | null
  new_type_id: string | null
  prev_type_id: string | null
}

/**
 * Returns the maximum INR variant price for a product, or null if no
 * variant has an INR price. Stored as whole rupees.
 */
async function getMaxInrPrice(
  container: any,
  productId: string
): Promise<number | null> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    filters: { id: productId },
    fields: [
      "id",
      "variants.id",
      "variants.price_set.prices.amount",
      "variants.price_set.prices.currency_code",
    ],
  })
  const product = (products ?? [])[0] as any
  if (!product) return null

  let max: number | null = null
  for (const v of product.variants ?? []) {
    for (const p of v?.price_set?.prices ?? []) {
      if (String(p?.currency_code ?? "").toLowerCase() !== "inr") continue
      const amount = Number(p?.amount ?? 0)
      if (!Number.isFinite(amount)) continue
      if (max === null || amount > max) max = amount
    }
  }
  return max
}

/**
 * Resolves the product_type IDs the classifier manages. Returns
 * { overId: string | null } — null when the seed has not been run
 * yet. The classifier skips work in that case to avoid races on
 * a partial install.
 */
async function resolveManagedTypeIds(
  container: any
): Promise<{ overId: string | null }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: types } = await query.graph({
    entity: "product_type",
    filters: { value: TAX_CLASS_OVER_2500_VALUE },
    fields: ["id", "value"],
  })
  const overId = (types ?? [])[0]?.id ?? null
  return { overId }
}

const classifyProductStep = createStep(
  "classify-product-tax-class",
  async (input: ClassifyProductInput, { container }): Promise<StepResponse<ClassifyProductResult>> => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const productService: any = container.resolve(Modules.PRODUCT)

    const { overId } = await resolveManagedTypeIds(container)
    if (!overId) {
      return new StepResponse({
        product_id: input.product_id,
        decision: "skipped",
        reason:
          "JYT-managed product_type rows missing — run seed-in-textile-tax-class.ts first",
        max_inr_price: null,
        new_type_id: null,
        prev_type_id: null,
      })
    }

    const { data: products } = await query.graph({
      entity: "product",
      filters: { id: input.product_id },
      fields: ["id", "type_id", "type.value"],
    })
    const product = (products ?? [])[0] as any
    if (!product) {
      return new StepResponse({
        product_id: input.product_id,
        decision: "skipped",
        reason: "Product not found",
        max_inr_price: null,
        new_type_id: null,
        prev_type_id: null,
      })
    }

    const prevTypeId: string | null = product.type_id ?? null
    const prevTypeValue: string | null = product.type?.value ?? null
    const ownsCurrentType =
      !prevTypeId ||
      (prevTypeValue !== null && JYT_MANAGED_TAX_CLASS_VALUES.has(prevTypeValue))

    if (!ownsCurrentType) {
      return new StepResponse({
        product_id: input.product_id,
        decision: "skipped",
        reason: `Product has partner-managed type_id=${prevTypeId} (value=${prevTypeValue}); will not overwrite`,
        max_inr_price: null,
        new_type_id: null,
        prev_type_id: prevTypeId,
      })
    }

    const maxInr = await getMaxInrPrice(container, input.product_id)
    const shouldAssign = maxInr !== null && maxInr >= IN_TEXTILE_THRESHOLD_INR
    const desiredTypeId = shouldAssign ? overId : null

    if (desiredTypeId === prevTypeId) {
      return new StepResponse({
        product_id: input.product_id,
        decision: "no-change",
        reason: shouldAssign
          ? `Already classified as over-2500 (max INR ${maxInr})`
          : `Already unclassified (max INR ${maxInr ?? "none"})`,
        max_inr_price: maxInr,
        new_type_id: desiredTypeId,
        prev_type_id: prevTypeId,
      })
    }

    // Dry-run: report the decision that WOULD be made, mutate nothing.
    if (input.dry_run) {
      return new StepResponse({
        product_id: input.product_id,
        decision: desiredTypeId ? "assigned" : "cleared",
        reason:
          (desiredTypeId
            ? `WOULD assign — max INR price ${maxInr} ≥ ${IN_TEXTILE_THRESHOLD_INR}`
            : `WOULD clear — max INR price ${maxInr ?? "none"} < ${IN_TEXTILE_THRESHOLD_INR}`),
        max_inr_price: maxInr,
        new_type_id: desiredTypeId,
        prev_type_id: prevTypeId,
      })
    }

    await productService.updateProducts(input.product_id, {
      type_id: desiredTypeId,
    })

    return new StepResponse({
      product_id: input.product_id,
      decision: desiredTypeId ? "assigned" : "cleared",
      reason: desiredTypeId
        ? `Max INR price ${maxInr} ≥ ${IN_TEXTILE_THRESHOLD_INR} threshold`
        : `Max INR price ${maxInr ?? "none"} < ${IN_TEXTILE_THRESHOLD_INR} threshold`,
      max_inr_price: maxInr,
      new_type_id: desiredTypeId,
      prev_type_id: prevTypeId,
    })
  },
  async (rollback: ClassifyProductResult | undefined, { container }) => {
    if (!rollback || rollback.decision === "skipped" || rollback.decision === "no-change") {
      return
    }
    const productService: any = container.resolve(Modules.PRODUCT)
    await productService.updateProducts(rollback.product_id, {
      type_id: rollback.prev_type_id ?? null,
    })
  }
)

export const classifyProductTaxClassWorkflow = createWorkflow(
  "classify-product-tax-class",
  (input: ClassifyProductInput) => {
    const result = classifyProductStep(input)
    return new WorkflowResponse(result)
  }
)

export default classifyProductTaxClassWorkflow
