/**
 * Formalized shape of `google_merchant_account.api_config`.
 *
 * Every field is optional — missing fields fall back to defaults used by the
 * sync workflows. Unknown keys are preserved on update to keep the column
 * forward-compatible, but the admin UI should only edit the documented ones.
 */
export interface GoogleMerchantApiConfig {
  /** Full Google resource name of the selected API data source, e.g.
   *  `accounts/123/dataSources/456`. Used as the `dataSource` param on
   *  productInputs:insert. Populated by the data-sources detect/create flow. */
  data_source_name?: string

  /** Content language (ISO 639-1), e.g. "en". Default: "en". */
  content_language?: string

  /** Feed label — typically an uppercase ISO country code, e.g. "US". Default: "US". */
  feed_label?: string

  /** Target country codes (2-letter ISO). When omitted, Google infers from feed_label. */
  target_countries?: string[]

  /** Fallback currency (ISO 4217) used when a variant has no price in the target currency. Default: "USD". */
  currency_code?: string

  /** Base URL prepended to `/products/<handle>` when building product landing URLs.
   *  e.g. "https://shop.example.com". Required for sync — workflows error without it. */
  landing_url_base?: string

  /** Default availability when the product doesn't provide one. */
  default_availability?: "in_stock" | "out_of_stock" | "preorder" | "backorder"

  /** Default condition when the product doesn't provide one. */
  default_condition?: "new" | "refurbished" | "used"

  /** Default brand name when the product metadata doesn't have one. */
  default_brand?: string

  /** Merchant Center channel. Default: "ONLINE_PRODUCTS". */
  channel?: "ONLINE_PRODUCTS" | "LOCAL_PRODUCTS" | "PRODUCTS"
}

export const API_CONFIG_KNOWN_KEYS: Array<keyof GoogleMerchantApiConfig> = [
  "data_source_name",
  "content_language",
  "feed_label",
  "target_countries",
  "currency_code",
  "landing_url_base",
  "default_availability",
  "default_condition",
  "default_brand",
  "channel",
]

const AVAILABILITY_VALUES = new Set(["in_stock", "out_of_stock", "preorder", "backorder"])
const CONDITION_VALUES = new Set(["new", "refurbished", "used"])
const CHANNEL_VALUES = new Set(["ONLINE_PRODUCTS", "LOCAL_PRODUCTS", "PRODUCTS"])

/**
 * Validates a partial api_config patch. Throws on bad shapes, returns the
 * normalized object. Unknown keys pass through untouched.
 */
export function validateApiConfigPatch(input: unknown): Record<string, any> {
  if (input === null) return {}
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("api_config must be an object")
  }
  const patch = input as Record<string, any>
  const out: Record<string, any> = { ...patch }

  const stringKeys: Array<keyof GoogleMerchantApiConfig> = [
    "data_source_name",
    "content_language",
    "feed_label",
    "currency_code",
    "landing_url_base",
    "default_brand",
  ]
  for (const k of stringKeys) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null) continue
    if (typeof v !== "string") throw new Error(`api_config.${k} must be a string`)
  }

  if (patch.target_countries !== undefined && patch.target_countries !== null) {
    if (!Array.isArray(patch.target_countries)) {
      throw new Error("api_config.target_countries must be an array of 2-letter codes")
    }
    for (const c of patch.target_countries) {
      if (typeof c !== "string" || !/^[A-Z]{2}$/.test(c)) {
        throw new Error(`api_config.target_countries contains invalid code "${c}"`)
      }
    }
  }

  if (
    patch.default_availability !== undefined &&
    patch.default_availability !== null &&
    !AVAILABILITY_VALUES.has(patch.default_availability)
  ) {
    throw new Error(
      `api_config.default_availability must be one of ${[...AVAILABILITY_VALUES].join(", ")}`
    )
  }
  if (
    patch.default_condition !== undefined &&
    patch.default_condition !== null &&
    !CONDITION_VALUES.has(patch.default_condition)
  ) {
    throw new Error(
      `api_config.default_condition must be one of ${[...CONDITION_VALUES].join(", ")}`
    )
  }
  if (
    patch.channel !== undefined &&
    patch.channel !== null &&
    !CHANNEL_VALUES.has(patch.channel)
  ) {
    throw new Error(`api_config.channel must be one of ${[...CHANNEL_VALUES].join(", ")}`)
  }

  return out
}
