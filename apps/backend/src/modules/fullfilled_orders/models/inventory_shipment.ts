import { model } from "@medusajs/framework/utils";

/**
 * A carrier shipment generated for an inventory order (#772 follow-up).
 *
 * Until now the carrier refs lived only in `inventory_order.metadata.shipment`
 * — a single mutable blob, so a second shipment overwrote the first, nothing
 * recorded WHICH pickup warehouse the carrier was told to collect from, and
 * shipments weren't queryable. This makes each shipment a first-class row
 * (linked to the order via inventory-orders-inventory-shipments), with the
 * resolved pickup identity persisted for auditability.
 */
const InventoryShipment = model.define("inventory_shipment", {
  id: model.id().primaryKey(),
  carrier: model.text(),
  awb: model.text().nullable(),
  tracking_number: model.text().nullable(),
  tracking_url: model.text().nullable(),
  label_url: model.text().nullable(),
  // The Shiprocket pickup nickname the shipment was created against, and the
  // stock location it resolved from (null when the legacy any-registered-pickup
  // fallback was used — that absence is itself the audit signal).
  pickup_location_name: model.text().nullable(),
  pickup_stock_location_id: model.text().nullable(),
  // Carrier-confirmed pickup date (YYYY-MM-DD), when one was scheduled.
  pickup_scheduled_date: model.text().nullable(),
  // Lifecycle: created → pickup_scheduled → picked_up → in_transit →
  // out_for_delivery → delivered. `rto` (return-to-origin) can occur from any
  // in-flight state; `cancelled` is terminal. The post-pickup values are fed by
  // the carrier tracking webhook (#888) — never set at creation time.
  // `booking_pending`: a manual-carrier request (India Post) waiting for staff
  // to book it on the carrier's side; it has no AWB until they fill one in.
  status: model
    .enum([
      "booking_pending",
      "created",
      "pickup_scheduled",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "rto",
      "cancelled",
    ])
    .default("created"),
  weight_grams: model.float().nullable(),
  dimensions_cm: model.json().nullable(),
  provider_refs: model.json().nullable(),
  metadata: model.json().nullable(),
});

export default InventoryShipment;
