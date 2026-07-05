import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildUcpContext, findRegionForCountry, getSupportedCountries } from "../lib/context"
import { formatUcpCheckoutSession, UCP_VERSION } from "../lib/formatter"
import { formatUcpError } from "../lib/error-formatter"
import { ucpAddressToMedusa } from "../lib/address-translator"
import { CHECKOUT_SESSION_CART_FIELDS } from "../lib/cart-fields"
import { callStoreRoute } from "../../mcp/lib/proxy"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * POST /ucp/checkout-sessions
 *
 * Create a UCP checkout session (maps to a Medusa cart).
 * The agent supplies line_items (item.id = variant_id), optional buyer,
 * shipping_address, and context (currency/region).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any

  try {
    // Translate UCP line_items → Medusa cart items
    const items = (body.line_items || []).map((li: any) => ({
      variant_id: li.item.id,
      quantity: li.quantity,
    }))

    const email = body.buyer?.email || body.buyer?.full_name ? body.buyer?.email : undefined
    const shippingAddress = body.shipping_address
      ? {
          ...ucpAddressToMedusa(body.shipping_address),
          ...(body.buyer?.first_name ? { first_name: body.buyer.first_name } : {}),
          ...(body.buyer?.last_name ? { last_name: body.buyer.last_name } : {}),
          ...(body.buyer?.full_name
            ? {
                first_name: body.buyer.full_name.split(" ")[0],
                last_name: body.buyer.full_name.split(" ").slice(1).join(" ") || undefined,
              }
            : {}),
          ...(body.buyer?.phone_number ? { phone: body.buyer.phone_number } : {}),
        }
      : undefined

    let regionId: string | undefined = body.context?.region_id
    const currencyCode = body.context?.currency

    // If the agent supplied a shipping address, pick a region whose country
    // list includes the target country.
    if (!regionId && shippingAddress?.country_code) {
      const match = await findRegionForCountry(ctx.container, shippingAddress.country_code)
      if (!match) {
        const supported = await getSupportedCountries(ctx.container)
        res.status(400).json(formatUcpError({
          ucpVersion: UCP_VERSION,
          code: "country_not_supported",
          content: `Country "${shippingAddress.country_code}" is not served by any region. Supported countries: ${supported.join(", ") || "(none configured)"}.`,
          severity: "recoverable",
          path: "$.shipping_address.address_country",
        }))
        return
      }
      regionId = match.id
    }

    // Create the cart via loopback proxy to /store/carts
    const cartBody: Record<string, unknown> = {
      items: items.map((i: any) => ({ variant_id: i.variant_id, quantity: i.quantity })),
      metadata: {
        is_checkout_session: true,
        protocol: "ucp",
        protocol_version: UCP_VERSION,
        agent_identifier: (req.headers["ucp-agent"] as string || "unknown").slice(0, 256),
        checkout_session_created_at: new Date().toISOString(),
      },
    }
    if (regionId) cartBody.region_id = regionId
    if (email) cartBody.email = email
    if (currencyCode) cartBody.currency_code = currencyCode.toLowerCase()
    if (shippingAddress) cartBody.shipping_address = shippingAddress
    if (body.discounts?.codes?.length) cartBody.promo_codes = body.discounts.codes

    const cartResp = await callStoreRoute({
      baseUrl: ctx.baseUrl,
      method: "POST",
      path: "/store/carts",
      body: cartBody,
      publishableKey: ctx.publishableKey,
    }) as any

    const cart = cartResp?.cart || cartResp

    // Fetch full cart with totals via query.graph
    const query = ctx.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [fullCart] } = await query.graph({
      entity: "cart",
      fields: CHECKOUT_SESSION_CART_FIELDS,
      filters: { id: cart.id },
    })

    // Attach container for shipping options resolution
    ;(fullCart as any)._container = ctx.container

    const session = await formatUcpCheckoutSession(
      { storeName: ctx.storeName, storefrontUrl: ctx.storefrontUrl, baseUrl: ctx.baseUrl },
      fullCart
    )

    res.status(201).json(session)
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
