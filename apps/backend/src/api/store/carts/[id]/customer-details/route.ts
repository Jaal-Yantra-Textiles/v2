/**
 * POST /store/carts/:id/customer-details
 *
 * Onboard the shopper onto a cart in one call: set email + shipping address (and
 * billing, defaulting to the same) from a FLAT, LLM-friendly payload. Backs the
 * MCP `set_customer_details` tool — the agent collects name/email/address in
 * conversation and posts them here before checkout. Setting the email also makes
 * the cart show up as a "recoverable" abandoned cart in admin.
 *
 * Returns 400 with `missing: [...]` when required shipping fields are absent, so
 * the agent knows exactly what to ask the user for.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateCartWorkflow } from "@medusajs/medusa/core-flows"
import { buildCartUpdate, type CustomerDetailsInput } from "./lib"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = req.params.id
  const body = (req.body || {}) as CustomerDetailsInput

  const { payload, missing } = buildCartUpdate(body)
  if (missing.length) {
    return res.status(400).json({
      type: "cart",
      error: `Missing required customer details: ${missing.join(", ")}. Ask the shopper for these and retry.`,
      missing,
    })
  }

  try {
    await updateCartWorkflow(req.scope).run({
      input: { id: cartId, ...payload },
    })
  } catch (e: any) {
    logger.error(`[Customer Details] update failed for cart ${cartId}: ${e?.message}`)
    return res.status(e?.status === 404 ? 404 : 400).json({
      type: "cart",
      error: e?.message || "Failed to apply customer details",
    })
  }

  // Return the freshened cart so the agent can confirm what was saved.
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.address_1",
      "shipping_address.city",
      "shipping_address.postal_code",
      "shipping_address.country_code",
      "shipping_address.phone",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) {
    return res.status(404).json({ type: "cart", error: "Cart not found" })
  }

  return res.json({ type: "cart", cart })
}
