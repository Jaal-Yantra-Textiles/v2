import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"

import productDesignLink from "../../links/product-design-link"
import { DESIGN_MODULE } from "../../modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import {
  isRelinkRefusal,
  planDesignProductRelink,
  type RelinkPlan,
} from "./lib/relink-design-product-plan"

export type RelinkDesignProductInput = {
  design_id: string
  product_id: string
  variant_ids?: string[] | null
  move_variants_from_other_designs?: boolean
  preview?: boolean
}

/**
 * Everything the plan needs, read once. Exported for the route's preview so a
 * preview and a write cannot read the world differently.
 */
export async function loadRelinkPlan(
  container: any,
  input: RelinkDesignProductInput
): Promise<RelinkPlan> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: designs = [] } = await query.graph({
    entity: "design",
    filters: { id: input.design_id },
    fields: ["id"],
  })
  if (!designs.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${input.design_id} was not found`
    )
  }

  const { data: products = [] } = await query.graph({
    entity: "product",
    filters: { id: input.product_id },
    fields: ["id", "variants.id"],
  })
  const product = products[0]

  // Through the link's entryPoint: a graph from `design` to a linked field
  // returns no key at all, which reads exactly like "no products".
  const { data: productLinks = [] } = await query.graph({
    entity: productDesignLink.entryPoint,
    filters: { design_id: input.design_id },
    fields: ["product_id"],
  })

  const { data: variantLinks = [] } = await query.graph({
    entity: "design_product_variant",
    filters: { design_id: input.design_id },
    fields: ["product_variant_id"],
  })
  const designVariantIds = (variantLinks as any[])
    .map((r) => r?.product_variant_id)
    .filter(Boolean) as string[]

  const variantProduct = new Map<string, string | null>()
  if (designVariantIds.length) {
    const { data: rows = [] } = await query.graph({
      entity: "product_variant",
      filters: { id: designVariantIds },
      fields: ["id", "product_id"],
    })
    for (const r of rows as any[]) variantProduct.set(r.id, r.product_id ?? null)
  }

  const variantDesigns = new Map<string, string>()
  const requested = input.variant_ids ?? []
  if (requested.length) {
    const { data: owners = [] } = await query.graph({
      entity: "design_product_variant",
      filters: { product_variant_id: requested },
      fields: ["design_id", "product_variant_id"],
    })
    for (const r of owners as any[]) {
      if (r?.product_variant_id && r?.design_id) {
        variantDesigns.set(r.product_variant_id, r.design_id)
      }
    }
  }

  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const runs = await runService.listProductionRuns(
    { design_id: input.design_id },
    {
      select: [
        "id",
        "product_id",
        "variant_id",
        "approved_product_id",
        "approved_variant_id",
      ],
    }
  )

  const plan = planDesignProductRelink({
    designId: input.design_id,
    target: product
      ? {
          id: product.id,
          variant_ids: (product.variants ?? []).map((v: any) => v.id),
        }
      : null,
    linkedProductIds: (productLinks as any[])
      .map((r) => r?.product_id)
      .filter(Boolean),
    designVariants: designVariantIds.map((variant_id) => ({
      variant_id,
      product_id: variantProduct.get(variant_id) ?? null,
    })),
    requestedVariantIds: input.variant_ids ?? null,
    variantDesigns,
    moveVariantsFromOtherDesigns: input.move_variants_from_other_designs === true,
    runs,
  })

  if (isRelinkRefusal(plan)) {
    throw new MedusaError(
      plan.error === "product_not_found"
        ? MedusaError.Types.NOT_FOUND
        : MedusaError.Types.INVALID_DATA,
      plan.message
    )
  }
  return plan
}

type Undo = {
  design_id: string
  linked_product: string | null
  unlinked_products: string[]
  linked_variants: string[]
  unlinked_variants: string[]
  moved_variants: Array<{ variant_id: string; from_design_id: string }>
  runs_before: Array<Record<string, any>>
}

const productLinkRow = (designId: string, productId: string) => ({
  [Modules.PRODUCT]: { product_id: productId },
  [DESIGN_MODULE]: { design_id: designId },
})
const variantLinkRow = (designId: string, variantId: string) => ({
  [DESIGN_MODULE]: { design_id: designId },
  [Modules.PRODUCT]: { product_variant_id: variantId },
})

const applyRelinkStep = createStep(
  "apply-design-product-relink",
  async (plan: RelinkPlan, { container }) => {
    const link = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const d = plan.design_id

    const undo: Undo = {
      design_id: d,
      linked_product: null,
      unlinked_products: [],
      linked_variants: [],
      unlinked_variants: [],
      moved_variants: [],
      runs_before: [],
    }

    if (plan.runs.length) {
      undo.runs_before = await runService.listProductionRuns(
        { id: plan.runs.map((r) => r.run_id) },
        {
          select: [
            "id",
            "product_id",
            "variant_id",
            "approved_product_id",
            "approved_variant_id",
          ],
        }
      )
    }

    // Every step is recorded as it lands, so a failure halfway undoes only
    // what actually happened.
    for (const pid of plan.unlink_product_ids) {
      await link.dismiss(productLinkRow(d, pid))
      undo.unlinked_products.push(pid)
    }
    if (plan.link_product) {
      await link.create(productLinkRow(d, plan.product_id))
      undo.linked_product = plan.product_id
    }
    for (const vid of plan.unlink_variant_ids) {
      await link.dismiss(variantLinkRow(d, vid))
      undo.unlinked_variants.push(vid)
    }
    for (const m of plan.moved_variants) {
      await link.dismiss(variantLinkRow(m.from_design_id, m.variant_id))
      undo.moved_variants.push(m)
    }
    for (const vid of plan.link_variant_ids) {
      await link.create({
        ...variantLinkRow(d, vid),
        data: { created_at: new Date() },
      })
      undo.linked_variants.push(vid)
    }
    for (const r of plan.runs) {
      await runService.updateProductionRuns({ id: r.run_id, ...r.update })
    }

    return new StepResponse(plan, undo)
  },
  async (undo: Undo | undefined, { container }) => {
    if (!undo) return
    const link = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const d = undo.design_id
    const quiet = (p: Promise<unknown>) => p.catch(() => {})

    for (const before of undo.runs_before) {
      await quiet(runService.updateProductionRuns(before))
    }
    for (const vid of undo.linked_variants) {
      await quiet(link.dismiss(variantLinkRow(d, vid)))
    }
    for (const m of undo.moved_variants) {
      await quiet(link.create(variantLinkRow(m.from_design_id, m.variant_id)))
    }
    for (const vid of undo.unlinked_variants) {
      await quiet(link.create(variantLinkRow(d, vid)))
    }
    if (undo.linked_product) {
      await quiet(link.dismiss(productLinkRow(d, undo.linked_product)))
    }
    for (const pid of undo.unlinked_products) {
      await quiet(link.create(productLinkRow(d, pid)))
    }
  }
)

/**
 * #2477 part 2 — the design now points at `product_id`. Plan it with
 * `loadRelinkPlan` (the route does, for the preview) and hand the plan here.
 */
export const relinkDesignProductWorkflow = createWorkflow(
  "relink-design-product",
  (plan: RelinkPlan) => {
    const applied = applyRelinkStep(plan)
    return new WorkflowResponse(applied)
  }
)

export default relinkDesignProductWorkflow
