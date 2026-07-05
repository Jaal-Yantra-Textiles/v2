import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildUcpContext, resolveRegionForAddressUpdate } from "../../lib/context"
import { formatUcpCheckoutSession, UCP_VERSION } from "../../lib/formatter"
import { formatUcpError } from "../../lib/error-formatter"
import { ucpAddressToMedusa } from "../../lib/address-translator"
import { CHECKOUT_SESSION_CART_FIELDS } from "../../lib/cart-fields"
import { extractSelectedFulfillmentOptionId } from "../../lib/fulfillment"
import { callStoreRoute } from "../../../mcp/lib/proxy"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /ucp/checkout-sessions/:id
 *
 * Retrieve a checkout session (cart) by id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const ctx = await buildUcpContext(req)

  try {
    const query = ctx.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    if (!cart) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Checkout session not found",
      }))
      return
    }

    ;(cart as any)._container = ctx.container
    const session = await formatUcpCheckoutSession(
      { storeName: ctx.storeName, storefrontUrl: ctx.storefrontUrl, baseUrl: ctx.baseUrl },
      cart
    )

    res.json(session)
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}

/**
 * PUT /ucp/checkout-sessions/:id
 *
 * Update a checkout session: add/update/remove line items, set email,
 * shipping address, apply discounts, select fulfillment option.
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any

  try {
    // Translate UCP field names to Medusa format
    const email = body.buyer?.email
    const shippingAddress = body.shipping_address
      ? ucpAddressToMedusa(body.shipping_address)
      : undefined

    const fulfillmentOptionId = extractSelectedFulfillmentOptionId(body.fulfillment)

    // Region resolution for address updates
    let regionId: string | undefined
    if (shippingAddress?.country_code) {
      const resolution = await resolveRegionForAddressUpdate(
        ctx.container, id, shippingAddress.country_code
      )
      if (!resolution.supported) {
        res.status(400).json(formatUcpError({
          ucpVersion: UCP_VERSION,
          code: "country_not_supported",
          content: `Country "${shippingAddress.country_code}" is not served by any region. Supported countries: ${resolution.supportedCountries.join(", ") || "(none configured)"}.`,
          severity: "recoverable",
          path: "$.shipping_address.address_country",
        }))
        return
      }
      if (resolution.shouldSwitch) {
        regionId = resolution.regionId
      }
    }

    // Build the cart update body
    const updateBody: Record<string, unknown> = {}
    if (email) updateBody.email = email
    if (shippingAddress) updateBody.shipping_address = shippingAddress
    if (regionId) updateBody.region_id = regionId
    if (body.context?.currency) updateBody.currency_code = body.context.currency.toLowerCase()

    // Apply promo codes if provided
    if (body.discounts?.codes?.length) {
      updateBody.promo_codes = body.discounts.codes
    }

    // Update cart properties via loopback proxy
    if (Object.keys(updateBody).length > 0) {
      await callStoreRoute({
        baseUrl: ctx.baseUrl,
        method: "POST",
        path: `/store/carts/${id}`,
        body: updateBody,
        publishableKey: ctx.publishableKey,
      })
    }

    // Handle line item updates
    if (body.line_items) {
      const toAdd = body.line_items.filter((li: any) => li.item?.id && !li.line_item_id && li.quantity > 0)
      const toUpdate = body.line_items.filter((li: any) => li.line_item_id && li.quantity > 0)
      const toRemove = body.line_items.filter((li: any) => li.line_item_id && li.quantity === 0)

      // Add new items
      for (const li of toAdd) {
        await callStoreRoute({
          baseUrl: ctx.baseUrl,
          method: "POST",
          path: `/store/carts/${id}/line-items`,
          body: { variant_id: li.item.id, quantity: li.quantity },
          publishableKey: ctx.publishableKey,
        })
      }

      // Update existing items
      for (const li of toUpdate) {
        await callStoreRoute({
          baseUrl: ctx.baseUrl,
          method: "POST",
          path: `/store/carts/${id}/line-items/${li.line_item_id}`,
          body: { quantity: li.quantity },
          publishableKey: ctx.publishableKey,
        })
      }

      // Remove items
      for (const li of toRemove) {
        await callStoreRoute({
          baseUrl: ctx.baseUrl,
          method: "DELETE",
          path: `/store/carts/${id}/line-items/${li.line_item_id}`,
          publishableKey: ctx.publishableKey,
        })
      }
    }

    // Apply fulfillment option (shipping method)
    if (fulfillmentOptionId) {
      await callStoreRoute({
        baseUrl: ctx.baseUrl,
        method: "POST",
        path: `/store/carts/${id}/shipping-methods`,
        body: { option_id: fulfillmentOptionId },
        publishableKey: ctx.publishableKey,
      })
    }

    // Fetch updated cart
    const query = ctx.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [updatedCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id },
    })

    if (!updatedCart) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Checkout session not found",
      }))
      return
    }

    ;(updatedCart as any)._container = ctx.container
    const session = await formatUcpCheckoutSession(
      { storeName: ctx.storeName, storefrontUrl: ctx.storefrontUrl, baseUrl: ctx.baseUrl },
      updatedCart
    )

    res.json(session)
  } catch (error: any) {
    const msg: string = error?.message || ""
    if (/Country with code .* is not within region/i.test(msg)) {
      res.status(400).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "country_not_supported",
        content: msg,
        severity: "recoverable",
        path: "$.shipping_address.address_country",
      }))
      return
    }
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: msg || "Internal error",
    }))
  }
}
