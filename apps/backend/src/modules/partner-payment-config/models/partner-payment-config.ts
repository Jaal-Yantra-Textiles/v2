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
  metadata: model.json().nullable(),
})

export default PartnerPaymentConfig
