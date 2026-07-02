import { model } from "@medusajs/framework/utils"

const PartnerPaymentConfig = model.define("partner_payment_config", {
  id: model.id().primaryKey(),
  partner_id: model.text(),
  provider_id: model.text(), // e.g. "pp_payu_payu", "pp_stripe_stripe"
  is_active: model.boolean().default(true),
  // Encrypted credentials JSON — structure depends on provider
  // PayU: { merchant_key, merchant_salt, mode }
  // Stripe: { api_key }
  credentials: model.json(),
  // --- JYT Stripe Connect (Standard account) ---
  // These are load-bearing, webhook-mutated fields, so they are typed columns
  // (not metadata — Medusa replaces the whole metadata blob on update).
  // Populated only for provider_id = "pp_stripe_stripe" when a partner
  // onboards via JYT's platform Stripe Connect instead of bringing their keys.
  connect_account_id: model.text().nullable(),
  // "pending" (onboarding not finished) | "active" (charges enabled)
  // | "restricted" (submitted but Stripe needs more) | "disconnected"
  connect_status: model.text().nullable(),
  connect_charges_enabled: model.boolean().default(false),
  connect_payouts_enabled: model.boolean().default(false),
  connect_details_submitted: model.boolean().default(false),
  metadata: model.json().nullable(),
})

export default PartnerPaymentConfig
