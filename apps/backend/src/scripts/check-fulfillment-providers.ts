import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Which fulfillment providers are actually registered in this environment.
 *
 * Carrier providers are opt-in locally (`ENABLE_CARRIER_FULFILLMENT=1`) because
 * the tokens in `.env` are live and Delhivery has no sandbox. This makes the
 * difference visible in one cheap command instead of being discovered by a
 * fulfilment that unexpectedly did — or didn't — reach a carrier.
 *
 *   ENABLE_CARRIER_FULFILLMENT=1 DELHIVERY_STUB=1 npx medusa exec ./src/scripts/check-fulfillment-providers.ts
 */
export default async function checkFulfillmentProviders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const flags = {
    ENABLE_CARRIER_FULFILLMENT: process.env.ENABLE_CARRIER_FULFILLMENT ?? "(unset)",
    DELHIVERY_STUB: process.env.DELHIVERY_STUB ?? "(unset)",
    DELHIVERY_API_TOKEN: process.env.DELHIVERY_API_TOKEN ? "set" : "(unset)",
    SHIPROCKET_EMAIL: process.env.SHIPROCKET_EMAIL ? "set" : "(unset)",
  }
  logger.info(`Env: ${JSON.stringify(flags)}`)

  if (process.env.DELHIVERY_STUB !== "1" && process.env.ENABLE_CARRIER_FULFILLMENT === "1") {
    logger.warn(
      "Carrier providers are ENABLED without DELHIVERY_STUB=1 — a fulfilment " +
        "here would hit the LIVE Delhivery account and mint a billable waybill."
    )
  }

  const fulfillment: any = container.resolve(Modules.FULFILLMENT)
  const providers = await fulfillment.listFulfillmentProviders({}, { take: 100 })

  logger.info(`Registered fulfillment providers (${providers.length}):`)
  for (const p of providers) {
    logger.info(`  - ${p.id}  enabled=${p.is_enabled}`)
  }
}
