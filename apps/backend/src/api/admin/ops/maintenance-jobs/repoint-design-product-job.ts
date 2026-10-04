import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { DESIGN_MODULE } from "../../../../modules/designs"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #2326 — move a design onto another product's variants.
 *
 * A design finds its product through `design_product_variant`, and a run's
 * completion refuses to bank when those variants sit on MORE than one product
 * (`resolveDesignProductId`). So merging two products into one — "Butterfly in
 * muslin" becoming the Muslin variants of "Butterfly Shirt" — is a link move,
 * and nothing in the admin surface could write it.
 *
 * The move: link the design to `variant_ids` (all on `product_id`), drop its
 * links to variants on any OTHER product, and make the product↔design link
 * match. The old product and its variants are left alone: an order line keeps
 * pointing at its own variant, and order lines find their design through the
 * design-order line link, not this one.
 *
 * Refuses a variant that already belongs to a different design — a variant is
 * made from exactly one design.
 */

const paramsSchema = z.object({
  design_id: z.string().min(1),
  product_id: z.string().min(1),
  variant_ids: z.array(z.string().min(1)).min(1),
})

export type RepointInput = {
  design_id: string
  product_id: string
  variant_ids: string[]
  /** Every variant the design is linked to now, with its product. */
  current: Array<{ variant_id: string; product_id: string | null }>
  /** The target variants as they stand: their product and current design. */
  targets: Array<{ variant_id: string; product_id: string | null; design_id: string | null }>
  /** Products the design is linked to at product level. */
  linked_product_ids: string[]
}

export type RepointPlan =
  | {
      ok: true
      link_variants: string[]
      unlink_variants: string[]
      link_product: boolean
      unlink_products: string[]
    }
  | { ok: false; reason: string }

/** PURE: what the move writes, or why it refuses. */
export function planRepointDesignProduct(input: RepointInput): RepointPlan {
  const targetById = new Map(input.targets.map((t) => [t.variant_id, t]))
  for (const id of input.variant_ids) {
    const t = targetById.get(id)
    if (!t) return { ok: false, reason: `variant ${id} not found` }
    if (t.product_id !== input.product_id) {
      return { ok: false, reason: `variant ${id} is on ${t.product_id}, not ${input.product_id}` }
    }
    if (t.design_id && t.design_id !== input.design_id) {
      return { ok: false, reason: `variant ${id} already belongs to design ${t.design_id}` }
    }
  }

  const linked = new Set(input.current.map((c) => c.variant_id))
  const link_variants = input.variant_ids.filter((id) => !linked.has(id))
  const unlink_variants = input.current
    .filter((c) => c.product_id !== input.product_id)
    .map((c) => c.variant_id)
  const link_product = !input.linked_product_ids.includes(input.product_id)
  const unlink_products = input.linked_product_ids.filter((p) => p !== input.product_id)

  return { ok: true, link_variants, unlink_variants, link_product, unlink_products }
}

export const repointDesignProductJob: MaintenanceJob = {
  id: "repoint-design-product",
  label: "Move a design onto another product's variants",
  description:
    "Link a design to the given variants of one product and drop its links to variants on any other product, so the design resolves to a single product (completion refuses to bank when a design's variants span two). Also makes the product↔design link match. The old product, its variants and any order lines on them are left untouched. Refuses a variant that belongs to another design. Preview first.",
  params: [
    { name: "design_id", type: "string", required: true, description: "The design to move" },
    { name: "product_id", type: "string", required: true, description: "The product it should resolve to" },
    {
      name: "variant_ids",
      type: "string",
      required: true,
      description: "Variants on product_id that this design backs (array of variant ids)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { design_id, product_id, variant_ids } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { data: currentLinks = [] } = await query.graph({
      entity: "design_product_variant",
      filters: { design_id },
      fields: ["product_variant_id"],
    })
    const currentIds = currentLinks.map((l: any) => l?.product_variant_id).filter(Boolean)
    const { data: targetLinks = [] } = await query.graph({
      entity: "design_product_variant",
      filters: { product_variant_id: variant_ids },
      fields: ["product_variant_id", "design_id"],
    })
    const { data: variants = [] } = await query.graph({
      entity: "product_variant",
      filters: { id: [...new Set([...currentIds, ...variant_ids])] },
      fields: ["id", "product_id"],
    })
    const productOf = new Map(variants.map((v: any) => [v.id, v.product_id ?? null]))
    const designOf = new Map(targetLinks.map((l: any) => [l.product_variant_id, l.design_id]))
    const { data: productLinks = [] } = await query.graph({
      entity: "product_design",
      filters: { design_id },
      fields: ["product_id"],
    })

    const plan = planRepointDesignProduct({
      design_id,
      product_id,
      variant_ids,
      current: currentIds.map((id: string) => ({
        variant_id: id,
        product_id: (productOf.get(id) as string | null) ?? null,
      })),
      targets: variant_ids
        .filter((id) => productOf.has(id))
        .map((id) => ({
          variant_id: id,
          product_id: (productOf.get(id) as string | null) ?? null,
          design_id: (designOf.get(id) as string | null) ?? null,
        })),
      linked_product_ids: productLinks.map((l: any) => l?.product_id).filter(Boolean),
    })
    if (!plan.ok) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, plan.reason)
    }

    const changes: MaintenanceChange[] = [
      ...plan.link_variants.map((id) => ({
        entity: "design_product_variant",
        id,
        field: "design_id",
        before: null,
        after: design_id,
      })),
      ...plan.unlink_variants.map((id) => ({
        entity: "design_product_variant",
        id,
        field: "design_id",
        before: design_id,
        after: null,
      })),
      ...(plan.link_product
        ? [{ entity: "product_design", id: product_id, field: "design_id", before: null, after: design_id }]
        : []),
      ...plan.unlink_products.map((id) => ({
        entity: "product_design",
        id,
        field: "design_id",
        before: design_id,
        after: null,
      })),
    ]

    if (!dry_run) {
      const variantLink = (id: string) => ({
        [DESIGN_MODULE]: { design_id },
        [Modules.PRODUCT]: { product_variant_id: id },
      })
      const productLink = (id: string) => ({
        [Modules.PRODUCT]: { product_id: id },
        [DESIGN_MODULE]: { design_id },
      })
      if (plan.unlink_variants.length) await link.dismiss(plan.unlink_variants.map(variantLink))
      if (plan.unlink_products.length) await link.dismiss(plan.unlink_products.map(productLink))
      if (plan.link_variants.length) {
        await link.create(
          plan.link_variants.map((id) => ({ ...variantLink(id), data: { created_at: new Date() } }))
        )
      }
      if (plan.link_product) await link.create(productLink(product_id))
    }

    const verb = dry_run ? "Would move" : "Moved"
    return {
      job_id: repointDesignProductJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: changes.length
        ? `${verb} design ${design_id} onto ${product_id}: +${plan.link_variants.length} / -${plan.unlink_variants.length} variant link(s)`
        : `No changes — design ${design_id} already resolves to ${product_id}`,
      changes,
    }
  },
}

export default repointDesignProductJob
