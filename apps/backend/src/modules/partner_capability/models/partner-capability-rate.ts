import { model } from "@medusajs/framework/utils"

import { RATE_UNITS } from "../lib/techniques"

/**
 * What a partner charges for one technique (#2596) — an ESTIMATE band, not a
 * price list. Partners rarely have exact rates on the spot, so a row is a
 * low–high range for a quantity band, with where the number came from.
 *
 * Absent ≠ zero: a technique with no row is shown as "ask", never ₹0
 * (reference_zero_is_not_null). `price_high` null means "about price_low".
 */
const PartnerCapabilityRate = model
  .define("partner_capability_rate", {
    id: model.id({ prefix: "pcrate" }).primaryKey(),

    partner_id: model.text().searchable(),

    /** A slug from lib/techniques.ts — validated on write, never free text. */
    technique: model.text().searchable(),

    /** Optional evidence: the sample photo this rate was quoted against. */
    sample_id: model.text().nullable(),

    unit: model.enum([...RATE_UNITS]).default("piece"),

    /** Quantity band this range holds for; null = any. */
    min_qty: model.number().nullable(),
    max_qty: model.number().nullable(),

    currency_code: model.text().default("inr"),
    price_low: model.bigNumber(),
    price_high: model.bigNumber().nullable(),
    /** One-off cost per order (screens, blocks, set-up). */
    setup_fee: model.bigNumber().nullable(),
    lead_days: model.number().nullable(),

    /**
     * Whether the partner's number included GST. Recorded per row rather than
     * decided globally — what the partner SAID is the fact; the quote converts.
     */
    tax_basis: model
      .enum(["gst_exclusive", "gst_inclusive", "unknown"])
      .default("unknown"),

    /**
     * partner_quoted — the partner told us; admin_estimate — our guess;
     * from_past_runs — derived from completed production runs.
     */
    source: model
      .enum(["partner_quoted", "admin_estimate", "from_past_runs"])
      .default("admin_estimate"),

    /** A derived rate is only a proposal until a person confirms it. */
    status: model.enum(["proposed", "confirmed"]).default("confirmed"),

    /** When this number was true — rates age; ~6 months old reads "recheck". */
    observed_at: model.dateTime(),

    notes: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["partner_id"], name: "idx_partner_capability_rate_partner" },
    { on: ["technique"], name: "idx_partner_capability_rate_technique" },
  ])

export default PartnerCapabilityRate
