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
import { BlueDartProviderAdapter } from "./bluedart/adapter"
import { DhlUnifiedTrackingClient } from "./dhl-unified-tracking"
import { DtdcProviderAdapter } from "@jytextiles/medusa-plugin-dtdc-shipping/providers/dtdc/adapter"
import { ShipglobalClient } from "./shipglobal/client"

/** Carriers `resolveShippingProvider` can return a live client for. */
export const SUPPORTED_CARRIERS: CarrierId[] = [
  "delhivery",
  "shiprocket",
  "bluedart",
  "dtdc",
  "shipglobal",
]

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
    // Tests/CI inject a deterministic transport (DELHIVERY_STUB=1) — Delhivery
    // has no usable sandbox, so a live create would mint a billable waybill.
    return new DelhiveryProviderAdapter({
      api_token: apiToken,
      sandbox,
      fetchImpl:
        process.env.DELHIVERY_STUB === "1"
          ? require("./delhivery/stub-fetch").createDelhiveryStubFetch()
          : undefined,
    })
  }

  if (id === "shiprocket") {
    const email =
      cfg.email || cfg.username || process.env.SHIPROCKET_EMAIL
    const password =
      readSecret(cfg, "password", encryption) ||
      process.env.SHIPROCKET_PASSWORD ||
      process.env.SHIPROCKET_API_PASSWORD
    if (!email || !password) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Shiprocket credentials not configured (no shipping platform record or SHIPROCKET_EMAIL + SHIPROCKET_API_PASSWORD/SHIPROCKET_PASSWORD)"
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

  if (id === "bluedart") {
    // Two-layer credentials: the gateway pair mints the JWT, the shipping
    // account travels in the request body. BOTH are required — a valid JWT with
    // a wrong LicenceKey fails deep inside the call with "UnauthorizedUser".
    const clientId =
      readSecret(cfg, "client_id", encryption) || process.env.BLUE_DART_CLIENT_ID
    const clientSecret =
      readSecret(cfg, "client_secret", encryption) ||
      process.env.BLUE_DART_CLIENT_SECRET
    const loginId =
      readSecret(cfg, "login_id", encryption) || process.env.BLUE_DART_LOGIN_ID
    const licenceKey =
      readSecret(cfg, "licence_key", encryption) ||
      process.env.BLUE_DART_LICENCE_KEY
    const customerCode =
      cfg.customer_code || process.env.BLUE_DART_CUSTOMER_CODE

    const missing = [
      !clientId && "BLUE_DART_CLIENT_ID",
      !clientSecret && "BLUE_DART_CLIENT_SECRET",
      !loginId && "BLUE_DART_LOGIN_ID",
      !licenceKey && "BLUE_DART_LICENCE_KEY",
      !customerCode && "BLUE_DART_CUSTOMER_CODE",
    ].filter(Boolean)
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Blue Dart credentials not configured (missing ${missing.join(", ")})`
      )
    }

    // Tracking goes through DHL's unified API when a key is available — Blue
    // Dart's own tracking endpoint needs a licence key we don't hold. The
    // gateway client id doubles as the DHL-API-Key.
    const trackingKey =
      readSecret(cfg, "dhl_tracking_api_key", encryption) ||
      process.env.DHL_UNIFIED_TRACKING_API_KEY ||
      clientId

    return new BlueDartProviderAdapter(
      {
        client_id: clientId!,
        client_secret: clientSecret!,
        login_id: loginId!,
        licence_key: licenceKey!,
        customer_code: customerCode!,
        api_type: cfg.api_type || process.env.BLUE_DART_API_TYPE,
        version: cfg.version || process.env.BLUE_DART_VERSION,
        origin_area: cfg.origin_area || process.env.BLUE_DART_ORIGIN_AREA,
        tracking_licence_key: process.env.BLUE_DART_TRACKING_LICENCE_KEY,
        // ⚠️ Blue Dart's sandbox issues SEPARATE shipping credentials — the
        // production LoginID does NOT work against it ("RequestAuthenticationFailed").
        // So sandbox mode is only meaningful with sandbox creds configured too.
        sandbox:
          (cfg.mode ? cfg.mode === "test" : undefined) ??
          process.env.BLUE_DART_SANDBOX === "true",
      },
      trackingKey
        ? new DhlUnifiedTrackingClient({ api_key: trackingKey })
        : undefined
    )
  }

  if (id === "dtdc") {
    // Two API surfaces with SEPARATE auth, but both are env/plaintext — DTDC
    // issues the customer_code + api-key pair for booking, and a
    // username/password (or a pre-minted X-Access-Token) for tracking.
    const customerCode =
      cfg.customer_code || process.env.DTDC_CUSTOMER_CODE
    const apiKey =
      readSecret(cfg, "api_key", encryption) || process.env.DTDC_API_KEY
    if (!customerCode || !apiKey) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "DTDC credentials not configured (no shipping platform record or DTDC_CUSTOMER_CODE + DTDC_API_KEY)"
      )
    }
    return new DtdcProviderAdapter({
      customer_code: customerCode!,
      api_key: apiKey!,
      sandbox:
        (cfg.mode ? cfg.mode === "test" : undefined) ??
        process.env.DTDC_SANDBOX === "true",
      tracking_username:
        cfg.tracking_username || process.env.DTDC_TRACKING_USERNAME,
      tracking_password:
        readSecret(cfg, "tracking_password", encryption) ||
        process.env.DTDC_TRACKING_PASSWORD,
      tracking_access_token:
        readSecret(cfg, "tracking_access_token", encryption) ||
        process.env.DTDC_TRACKING_ACCESS_TOKEN,
      default_service_type:
        (cfg.default_service_type as any) ||
        process.env.DTDC_DEFAULT_SERVICE_TYPE,
    } as any) as unknown as ShippingProviderClient
  }

  if (id === "shipglobal") {
    // Cross-border courier (India → international), HTTP Basic auth. The
    // username is the account email, the password is issued by ShipGlobal.
    const username =
      cfg.username || cfg.email || process.env.SHIPGLOBAL_USERNAME
    const password =
      readSecret(cfg, "password", encryption) || process.env.SHIPGLOBAL_PASSWORD
    if (!username || !password) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "ShipGlobal credentials not configured (no shipping platform record or SHIPGLOBAL_USERNAME + SHIPGLOBAL_PASSWORD)"
      )
    }
    return new ShipglobalClient({
      username: username!,
      password: password!,
      service: cfg.service || process.env.SHIPGLOBAL_SERVICE,
    })
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `No shipping provider registered for carrier "${carrier}"`
  )
}
