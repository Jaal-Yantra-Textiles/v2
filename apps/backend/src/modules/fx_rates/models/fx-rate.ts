import { model } from "@medusajs/framework/utils"

/**
 * One row per (base, quote) currency pair.
 *
 * Stored unidirectionally — provider returns rates against a single
 * base (USD for open.er-api.com), and the service computes cross-rates
 * on demand via the USD intermediate. We could store both directions
 * to save the divide, but cross-rate math is cheap and storing only
 * one direction keeps refresh writes minimal.
 *
 * `rate` is stored as text-via-bignumber under the hood (Medusa's
 * `bigNumber` type) to preserve precision — FX rates often have many
 * decimal places (USD→INR ≈ 83.247291). Avoid float drift.
 *
 * Composite key on (base_currency, quote_currency) keeps upserts
 * straightforward.
 */
const FxRate = model.define("fx_rate", {
  id: model.id().primaryKey(),
  base_currency: model.text().searchable(),
  quote_currency: model.text().searchable(),
  rate: model.bigNumber(),
  fetched_at: model.dateTime(),
  source: model.text(),
  metadata: model.json().nullable(),
}).indexes([
  {
    name: "IDX_fx_rate_pair_unique",
    on: ["base_currency", "quote_currency"],
    unique: true,
  },
])

export default FxRate
