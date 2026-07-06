import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveBaseUrl, resolveStorefrontUrl } from "../../ucp/lib/context"
import { UCP_VERSION } from "../../ucp/lib/formatter"

/**
 * GET /.well-known/ucp
 *
 * UCP discovery manifest. Tells agents what services and capabilities
 * this business supports, and where the API lives.
 *
 * NOTE: Medusa's file-based router ignores directories starting with ".",
 * so this file exists for reference but the actual route is registered
 * via defineMiddlewares in src/api/middlewares.ts.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const baseUrl = resolveBaseUrl(req)
  const callerKey = (req.headers["x-publishable-api-key"] as string) || undefined
  const storefrontUrl = await resolveStorefrontUrl(req.scope, req, callerKey)

  const paymentHandlers = [
    {
      id: "payu",
      name: "dev.jyt.payu",
      version: UCP_VERSION,
      spec: "https://ucp.dev/specs/mock",
      config_schema: "https://ucp.dev/schemas/mock.json",
      instrument_schemas: [
        "https://ucp.dev/schemas/shopping/types/card_payment_instrument.json",
      ],
      config: {
        description: "PayU — INR payments (cards, UPI, netbanking). Redirect-flow gateway.",
        currencies: ["inr"],
      },
    },
    {
      id: "stripe",
      name: "dev.jyt.stripe",
      version: UCP_VERSION,
      spec: "https://ucp.dev/specs/mock",
      config_schema: "https://ucp.dev/schemas/mock.json",
      instrument_schemas: [
        "https://ucp.dev/schemas/shopping/types/card_payment_instrument.json",
      ],
      config: {
        description: "Stripe — non-INR payments (cards, Apple/Google Pay). Hosted page or client_secret.",
        currencies: ["usd", "eur", "gbp", "aud", "cad", "sgd", "aed"],
      },
    },
  ]

  res.json({
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          {
            version: UCP_VERSION,
            transport: "rest",
            endpoint: `${baseUrl}/ucp`,
          },
        ],
      },
      capabilities: {
        "dev.ucp.shopping.catalog.search": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.catalog.lookup": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.cart": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.order": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.fulfillment": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.discount": [{ version: UCP_VERSION }],
      },
      payment_handlers: paymentHandlers,
    },
    store: {
      name: process.env.STORE_NAME || "JYT Store",
      url: storefrontUrl,
    },
  })
}
