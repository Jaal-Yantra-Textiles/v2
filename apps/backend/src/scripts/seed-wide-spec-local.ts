import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createProductsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import { upsertProductSpecWorkflow } from "../workflows/products/upsert-product-spec"

/**
 * LOCAL seed for the #1365 configurator's SECOND STEP.
 *
 * `seed-ikat-spec-local.ts` gives the narrow case — 2 groups, 3 values at the
 * widest — which stays inline in the buying column. This one crosses BOTH
 * overflow thresholds so the /customise route is exercised:
 *
 *   - 8 colours          → a group wider than 6
 *   - colours + 2 groups → 3 groups, more than 2
 *
 * Crossing both matters. A fixture that tripped only one threshold would let a
 * regression in the other half through unnoticed, and the two halves are
 * separate conditions in `needsSecondStep`.
 *
 * Idempotent — re-running updates the spec rather than duplicating the product.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-wide-spec-local.ts
 */
const HANDLE = "wide-choice-pashmina-local"

const IMAGES = [
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-back.png",
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-white-front.png",
]

const PALETTE = [
  { name: "Walnut", hex_code: "#5C4033", order: 0 },
  { name: "Saffron", hex_code: "#F4C430", order: 1 },
  { name: "Indigo", hex_code: "#3F51B5", order: 2 },
  { name: "Moss", hex_code: "#8A9A5B", order: 3 },
  { name: "Ivory", hex_code: "#FFFFF0", order: 4 },
  { name: "Rust", hex_code: "#B7410E", order: 5 },
  { name: "Slate", hex_code: "#708090", order: 6 },
  { name: "Rose Ash", hex_code: "#C9A9A6", order: 7 },
]

export default async function seedWideSpecLocal({ container }: ExecArgs) {
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
            title: "Wide-choice pashmina",
            handle: HANDLE,
            status: "published" as any,
            description:
              "A pashmina woven to order — eight colours, a border and a finish to choose from.",
            shipping_profile_id: shippingProfiles?.[0]?.id,
            sales_channels: salesChannels?.[0]
              ? [{ id: salesChannels[0].id }]
              : undefined,
            // Three images, because the second step PINS the image while the
            // choices scroll — a fixture with none would let that regress
            // silently, and one with a single image would not exercise the
            // thumbnails. Host is already in the storefront's
            // `next.config.js` remotePatterns; a new host would 400 at
            // next/image and read as a broken configurator.
            images: IMAGES.map((url) => ({ url })),
            options: [{ title: "Size", values: ["Stole", "Shawl"] }],
            variants: [
              {
                title: "Stole",
                sku: "WIDE-CHOICE-STOLE",
                manage_inventory: false,
                options: { Size: "Stole" },
                prices: [{ amount: 7800, currency_code: "inr" }],
              },
              {
                title: "Shawl",
                sku: "WIDE-CHOICE-SHAWL",
                manage_inventory: false,
                options: { Size: "Shawl" },
                prices: [{ amount: 11200, currency_code: "inr" }],
              },
            ],
          },
        ],
      },
    })
    productId = created.result[0].id
    logger.info(`[seed] created product ${productId} (${HANDLE}) with 2 variants`)
  } else {
    logger.info(`[seed] product ${productId} already exists — updating it`)
    // Images too, not just the spec. A seed that converges only on a fresh
    // database is a seed that quietly stops matching what the test expects the
    // second time anyone runs it.
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: productId },
        update: { images: IMAGES.map((url) => ({ url })) },
      },
    })
  }

  const { result: spec } = await upsertProductSpecWorkflow(container).run({
    input: {
      product_id: productId,
      data: {
        weave_technique: "twill",
        weave_label: "Twill, hand-spun pashmina",
        accepting_custom_orders: true,
        custom_order_lead_time_days: 21,
        colors: PALETTE,
        fields: [
          { key: "warp", label: "Warp", value: "Pashmina, 2/120s" },
          { key: "finished_size", label: "Finished size", value: '28" x 80"' },
        ],
        options: [
          {
            key: "border",
            label: "Border",
            help_text: "Woven in as the piece is made.",
            required: true,
            order: 0,
            values: [
              { label: "Plain selvedge", order: 0 },
              { label: "Narrow contrast", order: 1 },
              { label: "Wide contrast", order: 2 },
            ],
          },
          {
            key: "finish",
            label: "Finish",
            help_text: "How the cloth is treated once off the loom.",
            required: false,
            order: 1,
            values: [
              { label: "Soft wash", order: 0 },
              { label: "Light press", order: 1 },
            ],
          },
        ],
      },
    },
  })

  logger.info(
    `[seed] spec ${spec.id}: ${spec.colors?.length ?? 0} colours, ` +
      `${spec.options?.length ?? 0} option groups`
  )
  logger.info(`[seed] product handle: ${HANDLE}`)
}
