/**
 * POST /store/carts/:id/made-to-spec
 *
 * Add a made-to-order line item: the customer's chosen colourway plus a note,
 * validated against the partner's published production spec (#1342) and
 * snapshotted onto the line item.
 *
 * A dedicated route rather than the core `/line-items` call with metadata,
 * because the palette is a business rule the core route cannot know: whether a
 * colour is orderable lives in the spec, and a client posting metadata directly
 * would be trusted. This route is the only path that can write
 * `made_to_spec` metadata that means anything.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  QueryContext,
} from "@medusajs/framework/utils"
import { addToCartWorkflowId } from "@medusajs/core-flows"

import { applyRate, fetchExchangeRate } from "../../../../../lib/fx/exchange-rate"
import { PRODUCT_SPEC_MODULE } from "../../../../../modules/product-spec"
import {
  buildMadeToSpecSnapshot,
  MADE_TO_SPEC_METADATA_KEY,
  MADE_TO_SPEC_SETUP_METADATA_KEY,
  madeToSpecCharges,
  type MadeToSpecCharge,
  type MadeToSpecSelection,
} from "./lib"

type Body = MadeToSpecSelection & {
  variant_id: string
  quantity?: number
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = req.params.id
  const body = (req.validatedBody || req.body || {}) as Body

  /*
   * 🔴 Every rejection below carries BOTH `error` and `message`, and the
   * duplication is the point.
   *
   * This route has always answered `{ type, error }`. The Medusa JS SDK reads
   * `jsonError.message` and falls back to the HTTP status text, so every one of
   * these carefully-worded refusals — "Choose a colour. Available colours:
   * Natural White." — reached the storefront as the word "Bad Request". The
   * customise form catches it and prints it verbatim, which is exactly what its
   * comment says it does; there was simply nothing left to print.
   *
   * `error` stays because it is the shape this route has always sent and
   * something may read it. `message` is what makes the sentence survive.
   */
  if (!body.variant_id) {
    return res.status(400).json({
      type: "invalid_data",
      error: "variant_id is required.",
      message: "variant_id is required.",
    })
  }

  // The spec is keyed by PRODUCT, and the customer picks a VARIANT — so resolve
  // one to the other rather than trusting a product_id from the client.
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id"],
    filters: { id: body.variant_id },
  })

  const productId = variants?.[0]?.product_id
  if (!productId) {
    return res.status(404).json({
      type: "not_found",
      error: `Variant ${body.variant_id} was not found.`,
      message: `Variant ${body.variant_id} was not found.`,
    })
  }

  const service: any = req.scope.resolve(PRODUCT_SPEC_MODULE)
  const spec = await service.findByProduct(productId)

  let snapshot
  try {
    snapshot = buildMadeToSpecSnapshot({
      spec,
      selection: { color: body.color, note: body.note, options: body.options },
      now: new Date(),
      variantId: body.variant_id,
    })
  } catch (e: any) {
    const status =
      e?.type === MedusaError.Types.NOT_FOUND
        ? 404
        : e?.type === MedusaError.Types.NOT_ALLOWED
          ? 409
          : 400
    return res.status(status).json({
      type: e?.type || "invalid_data",
      error: e?.message || "That made-to-order choice is not available.",
      message: e?.message || "That made-to-order choice is not available.",
    })
  }

  const quantity = body.quantity ?? 1
  const items: any[] = [
    {
      variant_id: body.variant_id,
      quantity,
      metadata: { [MADE_TO_SPEC_METADATA_KEY]: snapshot },
    },
  ]

  /*
   * #2456 — priced choices. A free choice leaves the line exactly as it always
   * was: the variant's own price, calculated by the core workflow.
   *
   * A priced one cannot ride on the variant price, so the line gets a custom
   * unit price = the variant's live price + the per-piece surcharges, and each
   * one-time setup fee becomes its own line. The setup fee is a line rather
   * than spread over the pieces because ₹500 / 3 aprons does not divide, and
   * because the customer should see what they are paying for once.
   */
  const charges = madeToSpecCharges(snapshot)
  if (charges.per_piece.length || charges.setup.length) {
    try {
      const priced = await priceChargedLine({
        query,
        cartId,
        variantId: body.variant_id,
        productId,
        quantity,
        perPiece: charges.per_piece,
        setup: charges.setup,
      })
      items[0].unit_price = priced.unit_price
      items[0].is_tax_inclusive = priced.is_tax_inclusive
      items[0].metadata[MADE_TO_SPEC_METADATA_KEY] = {
        ...snapshot,
        pricing: priced.pricing,
      }
      items.push(...priced.setupItems)
    } catch (e: any) {
      logger.error(
        `[Made to spec] pricing failed for cart ${cartId}: ${e?.message}`
      )
      const message =
        e instanceof MedusaError
          ? e.message
          : "We could not price this choice right now. Please try again, or contact us."
      return res.status(e instanceof MedusaError ? 400 : 503).json({
        type: "pricing",
        error: message,
        message,
      })
    }
  }

  try {
    const we: any = req.scope.resolve(Modules.WORKFLOW_ENGINE)
    await we.run(addToCartWorkflowId, {
      input: {
        cart_id: cartId,
        items,
      },
    })
  } catch (e: any) {
    logger.error(
      `[Made to spec] add to cart failed for cart ${cartId}: ${e?.message}`
    )
    return res.status(e?.status === 404 ? 404 : 400).json({
      type: "cart",
      error: e?.message || "Could not add this made-to-order piece to the cart.",
      message: e?.message || "Could not add this made-to-order piece to the cart.",
    })
  }

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "items.id",
      "items.title",
      "items.quantity",
      "items.variant_id",
      "items.metadata",
    ],
    filters: { id: cartId },
  })

  return res.json({ cart: carts?.[0] ?? null, made_to_spec: snapshot })
}

/**
 * The custom unit price for a line with priced choices, and the setup-fee
 * lines that go with it. Every amount is converted from the value's own
 * currency into the cart's.
 */
async function priceChargedLine({
  query,
  cartId,
  variantId,
  productId,
  quantity,
  perPiece,
  setup,
}: {
  query: any
  cartId: string
  variantId: string
  productId: string
  quantity: number
  perPiece: MadeToSpecCharge[]
  setup: MadeToSpecCharge[]
}) {
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "currency_code", "region_id", "items.id", "items.metadata"],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart?.currency_code) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart ${cartId} was not found.`
    )
  }
  const currency = String(cart.currency_code).toLowerCase()

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "calculated_price.*"],
    filters: { id: variantId },
    context: {
      calculated_price: QueryContext({
        ...(cart.region_id ? { region_id: cart.region_id } : {}),
        currency_code: currency,
        quantity,
      }),
    },
  })
  const calculated = variants?.[0]?.calculated_price
  const base = Number(calculated?.calculated_amount)
  // A variant with no price in this currency is not a free variant. The core
  // route would refuse it too; say so before adding a surcharge to nothing.
  if (!Number.isFinite(base)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `This piece has no price in ${currency.toUpperCase()}, so it cannot be added.`
    )
  }
  const isTaxInclusive = !!calculated?.is_calculated_price_tax_inclusive

  const convert = async (c: MadeToSpecCharge) =>
    applyRate(c.amount, await fetchExchangeRate(c.currency_code, currency))

  let surcharge = 0
  const perPieceLines: any[] = []
  for (const c of perPiece) {
    const amount = await convert(c)
    surcharge += amount
    perPieceLines.push({ key: c.key, value: c.value, amount, original_amount: c.amount, original_currency: c.currency_code })
  }

  /*
   * One setup fee per design per cart: adding a second batch of the same
   * logo'd apron to the same cart is not a second logo. A REPEAT order of a
   * logo already digitised is not detectable here — admin waives it by hand.
   */
  const already = new Set(
    (cart.items ?? [])
      .map((i: any) => i?.metadata?.[MADE_TO_SPEC_SETUP_METADATA_KEY])
      .filter(Boolean)
      .map((m: any) => `${m.product_id}|${m.key}|${m.value}`)
  )
  const setupItems: any[] = []
  for (const c of setup) {
    if (already.has(`${productId}|${c.key}|${c.value}`)) continue
    const amount = await convert(c)
    setupItems.push({
      title: `${c.label}: ${c.value} (one-time setup)`,
      quantity: 1,
      unit_price: amount,
      is_tax_inclusive: isTaxInclusive,
      // #1195: a variant-less line must not require shipping on the CART, or
      // completion is blocked. Nothing ships for a setup fee anyway.
      requires_shipping: false,
      product_id: productId,
      metadata: {
        [MADE_TO_SPEC_SETUP_METADATA_KEY]: {
          product_id: productId,
          variant_id: variantId,
          key: c.key,
          label: c.label,
          value: c.value,
          amount,
          original_amount: c.amount,
          original_currency: c.currency_code,
          // The fee pays the supplier for the setup (logo digitising); it is
          // not our margin. Recorded so a payout can find it.
          payee: "supplier",
        },
      },
    })
  }

  return {
    unit_price: Math.round((base + surcharge) * 100) / 100,
    is_tax_inclusive: isTaxInclusive,
    pricing: {
      base_unit_price: base,
      surcharge_per_piece: Math.round(surcharge * 100) / 100,
      currency_code: currency,
      per_piece: perPieceLines,
    },
    setupItems,
  }
}
