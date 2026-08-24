/**
 * GET /store/products/:id/spec
 *
 * The public read of a product's production spec (#1342): what the piece is
 * made to, and — when the partner is taking made-to-order work — the palette a
 * customer may choose from.
 *
 * `:id` accepts a product id or a handle, because a storefront product page is
 * routed by handle and should not have to make a second call to learn the id.
 *
 * The stored spec carries param KEYS (`gsm`, `ends_per_inch`); a customer needs
 * labels and units. Rather than making every storefront ship a copy of the
 * catalog, the resolved technique is returned alongside — same reason the
 * editors read it from the API instead of hardcoding it.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCT_SPEC_MODULE } from "../../../../../modules/product-spec"
import { WEAVE_TECHNIQUES } from "../../../../../modules/product-spec/weaving-techniques"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const idOrHandle = req.params.id

  const { data: byId } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "status"],
    filters: { id: idOrHandle },
  })

  let product = byId?.[0]
  if (!product) {
    const { data: byHandle } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "status"],
      filters: { handle: idOrHandle },
    })
    product = byHandle?.[0]
  }

  if (!product) {
    return res.status(404).json({
      type: "not_found",
      error: `Product ${idOrHandle} was not found.`,
    })
  }

  const service: any = req.scope.resolve(PRODUCT_SPEC_MODULE)
  const spec = await service.findByProduct(product.id)

  // No spec is the normal state for most products, not an error — the
  // storefront simply renders nothing.
  if (!spec) {
    return res.json({ spec: null, technique: null })
  }

  const technique =
    WEAVE_TECHNIQUES.find((t) => t.slug === spec.weave_technique) ?? null

  // Colours the partner has switched off are not offered. They are dropped
  // here rather than in the storefront so every storefront — ours, the
  // starter, and anything built later — agrees on what is orderable.
  const colors = (spec.colors ?? [])
    .filter((c: any) => c.available !== false)
    .slice()
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))

  const fields = (spec.fields ?? [])
    .slice()
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))

  // Partner-defined choices. Unavailable VALUES are dropped for the same reason
  // unavailable colours are — every storefront should agree on what is
  // orderable — but a group is published even when `required` and empty, rather
  // than hidden. Hiding it would render a page that looks orderable and a cart
  // route that refuses, and the customer would never learn which is right.
  const options = (spec.options ?? [])
    .slice()
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((o: any) => ({
      id: o.id,
      key: o.key,
      label: o.label ?? o.key,
      help_text: o.help_text ?? null,
      required: !!o.required,
      values: (o.values ?? [])
        .filter((v: any) => v.available !== false)
        .slice()
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((v: any) => ({
          id: v.id,
          label: v.label,
          note: v.note ?? null,
        })),
    }))
    .filter((o: any) => o.required || o.values.length)

  return res.json({
    spec: {
      id: spec.id,
      weave_technique: spec.weave_technique ?? null,
      weave_label: spec.weave_label ?? null,
      params: spec.params ?? null,
      /**
       * The FINISHED piece's size — what a buyer means when they ask "how big
       * is it". Deliberately not folded into `params`: those are keyed to the
       * weave technique, and a product with no technique still has a size.
       */
      finished_length_cm: spec.finished_length_cm ?? null,
      finished_width_cm: spec.finished_width_cm ?? null,
      size_label: spec.size_label ?? null,
      finishes: spec.finishes ?? [],
      accepting_custom_orders: !!spec.accepting_custom_orders,
      custom_order_lead_time_days: spec.custom_order_lead_time_days ?? null,
      colors,
      fields,
      options,
      // `notes` is deliberately NOT returned: it is written as "notes for the
      // workshop" in the partner editor, and workshop notes are not customer
      // copy. Publishing them would change what partners feel able to write.
    },
    technique: technique
      ? {
          slug: technique.slug,
          label: technique.label,
          family: technique.family,
          description: technique.description,
          params: technique.params.map((p) => ({
            key: p.key,
            label: p.label,
            unit: p.unit,
            // #1364 — the glyph the storefront draws beside this row. Sent from
            // the registry rather than mapped storefront-side on the param
            // name, so a param added here cannot quietly render naked.
            icon: p.icon,
          })),
        }
      : null,
  })
}
