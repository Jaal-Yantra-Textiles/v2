import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import BlueDartFulfillmentService from "./service"

/**
 * The DEFAULT export is what makes Blue Dart visible in Settings → Locations &
 * Shipping. Until #1285 this file was a plain barrel, so the fulfillment module
 * had nothing to register and the carrier — though fully drivable through
 * `resolveShippingProvider` — could not be attached to a stock location.
 *
 * The named re-exports below are kept for callers that reach for the barrel.
 * Nothing does today (`resolver.ts` deep-imports `./bluedart/adapter`), but they
 * cost nothing and removing them would be a gratuitous break.
 */
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [BlueDartFulfillmentService],
})

export {
  BlueDartProviderAdapter,
  normalizeBlueDartTracking,
  classifyBlueDartScan,
} from "./adapter"
export { BlueDartClient, BlueDartApiError, describeBlueDartFailure } from "./client"
export * from "./constants"
export type * from "./types"
