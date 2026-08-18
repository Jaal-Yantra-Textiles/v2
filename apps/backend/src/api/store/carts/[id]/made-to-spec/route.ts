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
} from "@medusajs/framework/utils"
import { addToCartWorkflowId } from "@medusajs/core-flows"

import { PRODUCT_SPEC_MODULE } from "../../../../../modules/product-spec"
import {
  buildMadeToSpecSnapshot,
  MADE_TO_SPEC_METADATA_KEY,
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

  if (!body.variant_id) {
    return res.status(400).json({
      type: "invalid_data",
      error: "variant_id is required.",
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
    })
  }

  const service: any = req.scope.resolve(PRODUCT_SPEC_MODULE)
  const spec = await service.findByProduct(productId)

  let snapshot
  try {
    snapshot = buildMadeToSpecSnapshot({
      spec,
      selection: { color: body.color, note: body.note },
      now: new Date(),
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
    })
  }

  try {
    const we: any = req.scope.resolve(Modules.WORKFLOW_ENGINE)
    await we.run(addToCartWorkflowId, {
      input: {
        cart_id: cartId,
        items: [
          {
            variant_id: body.variant_id,
            quantity: body.quantity ?? 1,
            metadata: { [MADE_TO_SPEC_METADATA_KEY]: snapshot },
          },
        ],
      },
    })
  } catch (e: any) {
    logger.error(
      `[Made to spec] add to cart failed for cart ${cartId}: ${e?.message}`
    )
    return res.status(e?.status === 404 ? 404 : 400).json({
      type: "cart",
      error: e?.message || "Could not add this made-to-order piece to the cart.",
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
