/**
 * Carrier-keyed shipping-provider resolver (#31 spike).
 *
 * Given a carrier id (as persisted on `fulfillment.data.carrier`), returns a
 * ShippingProviderClient with credentials sourced from the `SocialPlatform`
 * external-platform store (`category: "shipping"`), decrypted via the
 * encryption module. Falls back to env vars so existing Delhivery flows keep
 * working before any platform record is created.
 *
 * This replaces the `new DelhiveryClient(...)` + `if (carrier === "delhivery")`
 * branching in the partner label/tracking/pickup routes. Those routes will be
 * migrated onto `resolveShippingProvider(req.scope, carrier)` in a follow-up.
 *
 * Credentials are read from `api_config`, preferring the encrypted
 * `<field>_encrypted` blob and falling back to any plaintext (mirrors how the
 * google-ads workflow steps decrypt). The platform is matched by
 * `api_config.provider` / `api_config.provider_type` / name, case-insensitively.
 */
import { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { ENCRYPTION_MODULE } from "../encryption"
import type EncryptionService from "../encryption/service"
import { SOCIALS_MODULE } from "../socials"
import { CarrierId, ShipmentRef, ShippingProviderClient } from "./provider-interface"
import { DelhiveryProviderAdapter } from "./delhivery/adapter"
import { ShiprocketClient } from "./shiprocket/client"

/** Carriers `resolveShippingProvider` can return a live client for. */
export const SUPPORTED_CARRIERS: CarrierId[] = ["delhivery", "shiprocket"]

/**
 * True when a carrier has a registered ShippingProviderClient. Consumer routes
 * use this to decide whether to drive the carrier API or fall back to stored
 * data (e.g. manual fulfillments with no carrier).
 */
export function isSupportedCarrier(
  carrier?: string | null
): carrier is CarrierId {
  return SUPPORTED_CARRIERS.includes(String(carrier || "").toLowerCase() as CarrierId)
}

/**
 * Reconstruct a ShipmentRef from a fulfillment's persisted `data`. The provider
 * service writes `{ carrier, waybill, ...provider_refs }` flat onto
 * `fulfillment.data`, so Delhivery needs only the waybill while Shiprocket's
 * label/track/cancel need `shipment_id` / `sr_order_id`. This collects both.
 */
export function shipmentRefFromFulfillment(
  data?: Record<string, any> | null
): ShipmentRef {
  const d = data || {}
  const awb = d.waybill || d.tracking_number || d.awb || undefined
  return {
    awb,
    provider_refs: {
      waybill: awb,
      shipment_id: d.shipment_id,
      sr_order_id: d.sr_order_id,
      ...(d.provider_refs || {}),
    },
  }
}

/** Decrypt a `<field>` from an api_config, preferring the encrypted blob. */
function readSecret(
  apiConfig: Record<string, any>,
  field: string,
  encryption?: EncryptionService
): string | undefined {
  const enc = apiConfig?.[`${field}_encrypted`]
  if (enc && encryption) {
    try {
      return encryption.decrypt(enc)
    } catch {
      /* fall through to plaintext */
    }
  }
  const plain = apiConfig?.[field]
  return typeof plain === "string" && plain.length ? plain : undefined
}

/** Find the active shipping platform record for a carrier, if one exists. */
async function findShippingPlatform(
  container: MedusaContainer,
  carrier: string
): Promise<Record<string, any> | null> {
  try {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const platforms = await socials.listSocialPlatforms({
      category: "shipping",
      status: "active",
    })
    const match = (platforms || []).find((p: any) => {
      const cfg = (p.api_config as Record<string, any>) || {}
      const type = String(
        cfg.provider_type || cfg.provider || p.name || ""
      ).toLowerCase()
      return type === carrier || type.includes(carrier)
    })
    return match || null
  } catch {
    // socials module unavailable — caller falls back to env vars
    return null
  }
}

/**
 * Resolve a ShippingProviderClient for the given carrier. Prefers an admin-
 * configured external-platform record; falls back to env vars.
 */
export async function resolveShippingProvider(
  container: MedusaContainer,
  carrier: CarrierId | string
): Promise<ShippingProviderClient> {
  const id = String(carrier || "").toLowerCase()
  let encryption: EncryptionService | undefined
  try {
    encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
  } catch {
    encryption = undefined
  }

  const platform = await findShippingPlatform(container, id)
  const cfg = (platform?.api_config as Record<string, any>) || {}

  if (id === "delhivery") {
    const apiToken =
      readSecret(cfg, "api_key", encryption) ||
      readSecret(cfg, "api_token", encryption) ||
      readSecret(cfg, "access_token", encryption) ||
      process.env.DELHIVERY_API_TOKEN
    if (!apiToken) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Delhivery credentials not configured (no shipping platform record or DELHIVERY_API_TOKEN)"
      )
    }
    const sandbox =
      (cfg.mode ? cfg.mode === "test" : undefined) ??
      process.env.DELHIVERY_SANDBOX === "true"
    return new DelhiveryProviderAdapter({ api_token: apiToken, sandbox })
  }

  if (id === "shiprocket") {
    const email =
      cfg.email || cfg.username || process.env.SHIPROCKET_EMAIL
    const password =
      readSecret(cfg, "password", encryption) || process.env.SHIPROCKET_PASSWORD
    if (!email || !password) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Shiprocket credentials not configured (no shipping platform record or SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD)"
      )
    }
    // Tests/CI inject a deterministic transport (SHIPROCKET_STUB=1) so the
    // in-process server never calls the real API — patching global.fetch isn't
    // reliable across the test↔server boundary (#647). Inert otherwise.
    const fetchImpl =
      process.env.SHIPROCKET_STUB === "1"
        ? require("./shiprocket/stub-fetch").createShiprocketStubFetch()
        : undefined

    return new ShiprocketClient({
      email,
      password,
      pickup_location:
        cfg.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION,
      fetchImpl,
    })
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `No shipping provider registered for carrier "${carrier}"`
  )
}
