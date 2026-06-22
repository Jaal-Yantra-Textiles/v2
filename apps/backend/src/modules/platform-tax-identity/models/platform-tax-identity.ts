import { model } from "@medusajs/framework/utils"

/**
 * Platform tax identity (#348 slice B) — an admin-managed row mapping a brand
 * entity to the tax/GST/VAT registration ID the platform bills under in a set of
 * countries, used as the fallback when a partner has no tax ID of their own.
 *
 * One row per brand/jurisdiction (e.g. JYT GSTIN for IN, KHT EU-VAT for the 27
 * EU states). `country_codes` is a `text[]` so a row can cover many countries;
 * multiple rows per brand are allowed for per-state GSTINs later.
 */
const PlatformTaxIdentity = model.define("platform_tax_identity", {
  id: model.id().primaryKey(),
  /** Short brand handle, e.g. "JYT" or "KHT". */
  brand_code: model.text(),
  /** Registered legal entity name as it appears on the document. */
  legal_name: model.text(),
  /** The tax / GST / VAT registration number. */
  tax_id: model.text(),
  /** ID scheme, e.g. "gstin" or "eu_vat". */
  tax_id_type: model.text(),
  /** ISO alpha-2 country codes this identity is registered to bill under. */
  country_codes: model.array(),
  /** Disabled rows are skipped by the resolver without being deleted. */
  is_active: model.boolean().default(true),
})

export default PlatformTaxIdentity
