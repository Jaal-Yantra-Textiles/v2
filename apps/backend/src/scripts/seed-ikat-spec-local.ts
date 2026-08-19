import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { upsertProductSpecWorkflow } from "../workflows/products/upsert-product-spec"

/**
 * LOCAL seed for the made-to-order option groups.
 *
 * Reproduces prod's `ikat-grid-patterns-blue-yellow` with one change: the
 * "Color Pattern" axis is NOT a product option any more. On prod it is, giving
 * 3 patterns × 2 spins = 6 variants — six SKUs for a piece that is woven to
 * order and never stocked. Here the product keeps only the axis that is a real
 * stocked difference (Spin Type, 2 variants), and the pattern becomes a spec
 * choice validated and snapshotted at add-to-cart.
 *
 * Embroidery is the second group, and the reason the spec grew option groups at
 * all: it is a choice, so it fits neither the palette nor the fixed fields.
 *
 * Idempotent — re-running updates the spec rather than duplicating the product.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-ikat-spec-local.ts
 */
const HANDLE = "ikat-grid-patterns-blue-yellow"

export default async function seedIkatSpecLocal({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existing } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "status"],
    filters: { handle: HANDLE },
  })

  let productId = existing?.[0]?.id

  if (!productId) {
    const { data: salesChannels } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "name"],
    })
    const { data: shippingProfiles } = await query.graph({
      entity: "shipping_profile",
      fields: ["id"],
    })

    const created = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: "Ikat grid patterns of blue and yellow color",
            handle: HANDLE,
            status: "published" as any,
            description:
              "Handwoven ikat, gridded in blue and yellow. Woven to order in the pattern you choose.",
            shipping_profile_id: shippingProfiles?.[0]?.id,
            sales_channels: salesChannels?.[0]
              ? [{ id: salesChannels[0].id }]
              : undefined,
            // Only the axis that is a real stocked difference. The pattern is
            // deliberately absent — that is the whole point of the seed.
            options: [{ title: "Spin Type", values: ["HandSpun", "MilSpun"] }],
            variants: [
              {
                title: "HandSpun",
                sku: "IKAT-GRID-HANDSPUN",
                manage_inventory: false,
                options: { "Spin Type": "HandSpun" },
                prices: [{ amount: 4500, currency_code: "inr" }],
              },
              {
                title: "MilSpun",
                sku: "IKAT-GRID-MILSPUN",
                manage_inventory: false,
                options: { "Spin Type": "MilSpun" },
                prices: [{ amount: 3200, currency_code: "inr" }],
              },
            ],
          },
        ],
      },
    })
    productId = created.result[0].id
    logger.info(`[seed] created product ${productId} (${HANDLE}) with 2 variants`)
  } else {
    logger.info(`[seed] product ${productId} already exists — updating its spec`)
  }

  const { result: spec } = await upsertProductSpecWorkflow(container).run({
    input: {
      product_id: productId,
      data: {
        weave_technique: "ikat",
        weave_label: "Ikat, grid, blue and yellow",
        accepting_custom_orders: true,
        custom_order_lead_time_days: 30,
        notes: "Grid registration drifts in damp weather — allow an extra day.",
        // The palette stays EMPTY: the colour question is asked by the
        // "Color Pattern" group below, and asking it twice would let a customer
        // answer it two ways.
        colors: [],
        fields: [
          { key: "warp", label: "Warp", value: "Cotton, 2/60s" },
          { key: "finished_size", label: "Finished size", value: '44" x 90"' },
        ],
        options: [
          {
            key: "color_pattern",
            label: "Color Pattern",
            help_text: "The gridded colourway this piece is woven in.",
            required: true,
            order: 0,
            values: [
              { label: "Pattern 1 - Blue/Mustard/Cream/Grey", order: 0 },
              { label: "Pattern 2 - Mustard/Dusty Blue/Grey", order: 1 },
              { label: "Pattern 3 - Blue/Yellow/Grey/Cream", order: 2 },
            ],
          },
          {
            key: "embroidery",
            label: "Embroidery",
            help_text: "Hand-worked after the weaving is finished.",
            required: false,
            order: 1,
            values: [
              { label: "Kashida — border only", note: "adds about 10 days", order: 0 },
              { label: "Kashida — border and pallu", note: "adds about 3 weeks", order: 1 },
              {
                label: "Sozni — fine, all over",
                note: "currently booked out",
                order: 2,
                available: false,
              },
            ],
          },
        ],
      },
    },
  })

  logger.info(
    `[seed] spec ${spec.id}: ${spec.options?.length ?? 0} option groups, ` +
      `${(spec.options ?? []).reduce(
        (n: number, o: any) => n + (o.values?.length ?? 0),
        0
      )} values`
  )
  logger.info(`[seed] product handle: ${HANDLE}`)
}
