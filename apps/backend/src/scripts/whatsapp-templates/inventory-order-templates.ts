/**
 * WhatsApp template spec for inventory-order status notifications (#771).
 *
 * One generic UTILITY template the inventory-order status flow
 * (seed-inventory-order-status-flow.ts) sends on every notified transition
 * (Processing / Shipped / Partial / Delivered / Cancelled). A single
 * parameterized template keeps the Meta-approval burden at ONE template instead
 * of one per status; the human status label is passed as a positional variable.
 *
 * Placeholders (positional, must match the flow's `variables` order):
 *   {{1}} partner first name
 *   {{2}} inventory order id
 *   {{3}} human status label ("In Production", "Shipped", "Delivered", …)
 *
 * Format follows partner-payment-templates.ts — text-only (no buttons/header)
 * for fastest approval; body shape identical across languages (Meta enforces);
 * every placeholder needs an example for approval. Promote to a `_v2` (IMAGE
 * header) only if we ever need delivery outside the 24h customer-care window.
 */

import type { TemplateSpec } from "./partner-run-templates"

const TEMPLATE_INVENTORY_ORDER_STATUS: TemplateSpec = {
  name: "jyt_inventory_order_status_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, your inventory order {{2}} is now *{{3}}*.\n\n" +
        "We'll keep you updated as it progresses. " +
        "Thanks for working with us.",
      examples: ["Rajesh", "inv_order_01ABC", "Shipped"],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, आपका इन्वेंटरी ऑर्डर {{2}} अब *{{3}}* है।\n\n" +
        "प्रगति होने पर हम आपको सूचित करते रहेंगे। " +
        "साथ काम करने के लिए धन्यवाद।",
      examples: ["राजेश", "inv_order_01ABC", "Shipped"],
    },
  ],
}

/**
 * Shipment-level pickup milestones (#888 S3). Sent by the
 * seed-inventory-shipment-pickup-flow dispatcher on the
 * `inventory_orders.inventory-shipment.status-changed` event — pickup
 * scheduled ("a courier arrives on <date>") and picked up. Order-level
 * Shipped/Delivered stay on jyt_inventory_order_status_v1 above, so the two
 * flows never say the same thing twice.
 *
 * Placeholders (positional, must match the flow's `variables` order):
 *   {{1}} partner first name
 *   {{2}} inventory order id
 *   {{3}} AWB / tracking number
 *   {{4}} milestone label ("Pickup scheduled for 2026-07-08", "Picked up by the courier")
 */
const TEMPLATE_INVENTORY_SHIPMENT_PICKUP: TemplateSpec = {
  name: "jyt_inventory_shipment_pickup_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, pickup update for your inventory order {{2}} (AWB {{3}}): *{{4}}*.\n\n" +
        "We'll keep you updated as it progresses. " +
        "Thanks for working with us.",
      examples: [
        "Rajesh",
        "inv_order_01ABC",
        "776123456789",
        "Pickup scheduled for 2026-07-08",
      ],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, आपके इन्वेंटरी ऑर्डर {{2}} (AWB {{3}}) के पिकअप की जानकारी: *{{4}}*।\n\n" +
        "प्रगति होने पर हम आपको सूचित करते रहेंगे। " +
        "साथ काम करने के लिए धन्यवाद।",
      examples: [
        "राजेश",
        "inv_order_01ABC",
        "776123456789",
        "Pickup scheduled for 2026-07-08",
      ],
    },
  ],
}

export const INVENTORY_ORDER_TEMPLATES: TemplateSpec[] = [
  TEMPLATE_INVENTORY_ORDER_STATUS,
  TEMPLATE_INVENTORY_SHIPMENT_PICKUP,
]
