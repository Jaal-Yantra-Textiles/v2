import { model } from "@medusajs/framework/utils";

/**
 * A physical movement of produced goods between two stock locations (#891).
 *
 * A partner produces a garment in a production run and the output frequently
 * has to MOVE before it can be sold: to another partner or a JYT warehouse for
 * finishing / embroidery / QC / packaging, and from there either into stock at
 * that location or on to the customer. Until now the platform assumed finished
 * goods were born at the producing partner's location and stayed there —
 * `stockFinishedGoodsStep` incremented an inventory level at an *implicit*
 * location and nothing could move it afterwards, which quietly made both the
 * reservation and the customer leg's ship-from wrong the moment goods travelled.
 *
 * Deliberately a small entity that *references* the shipment machinery rather
 * than duplicating it: the carrier row stays an `inventory_shipment` (same
 * module, same tracking webhook), and this records the movement's intent — what
 * moved, from where to where, and why. That was the choice over generalising
 * `inventory_shipment` polymorphically (which would touch every existing
 * shipment) and over reusing inventory ORDERS (a procurement document; finished
 * goods hops would pollute procurement reporting and partner payouts).
 *
 * `shipment_id` is a plain column, not a relation, so adding transfers does not
 * migrate the live `inventory_shipment` table. It is nullable because a hop can
 * be recorded before (or without) a carrier booking — a partner van run between
 * two of our own locations is a real transfer with no AWB.
 */
const GoodsTransfer = model.define("goods_transfer", {
  id: model.id({ prefix: "gtrf" }).primaryKey(),

  // What moved. A transfer always originates in a production run — that is the
  // only thing that makes goods exist at a location in the first place.
  production_run_id: model.text().searchable(),
  design_id: model.text().nullable(),
  quantity: model.float().default(1),

  // Where it moved. Both are stock-location ids; `to_location_id` is nullable
  // for the customer leg, whose destination is an order address, not a location.
  from_location_id: model.text(),
  to_location_id: model.text().nullable(),

  /**
   * Why it moved. `finishing` / `qc` / `packaging` are work hops (the goods come
   * back or continue), `stock` parks them at the destination, `customer` is the
   * final leg. This is the field that distinguishes a relocation from the run
   * itself — work done AT the destination by another partner is a sub-partner
   * production run, not a transfer.
   */
  reason: model
    .enum(["finishing", "qc", "packaging", "stock", "customer", "other"])
    .default("stock"),

  /**
   * Lifecycle. `draft` is a planned hop with nothing booked; `in_transit`
   * begins once a carrier shipment exists (or the partner marks it handed over);
   * `delivered` is the receipt, which is what moves inventory between the two
   * locations. `cancelled` is terminal.
   */
  status: model
    .enum(["draft", "in_transit", "delivered", "cancelled"])
    .default("draft"),

  /**
   * The `inventory_shipment` row carrying the AWB, label and tracking for this
   * hop, when it was booked with a carrier. Null for an un-booked or
   * self-driven movement.
   */
  shipment_id: model.text().nullable(),

  // Receipt confirmation stays explicit (mirroring the #888 decision): a carrier
  // saying "delivered" is not the same as someone at the destination having
  // counted the box.
  shipped_at: model.dateTime().nullable(),
  received_at: model.dateTime().nullable(),
  received_quantity: model.float().nullable(),

  /**
   * When this transfer's INVENTORY MOVEMENT was posted (#891, 2026-09-13).
   *
   * 🔴 Distinct from `received_at`, and the distinction is the whole point.
   * Receipt is a physical fact — someone counted the box. Posting is an
   * accounting act, and the founder call is that it requires the run to have
   * been APPROVED: partner completion is a claim, admin approval is the
   * acceptance of that claim, and stock must not enter our books on an
   * unaccepted one.
   *
   * The two can therefore happen in either order. Received first → the goods
   * are here, `received_at` is set and this stays null until approval posts
   * it. Approved first → receipt posts immediately and both are set together.
   * A transfer with `received_at` set and this null is the one state a reader
   * must not mistake for "moved": the goods are physically at the destination
   * and still on the partner's books.
   *
   * A typed column rather than a metadata key, deliberately — this decides
   * where real goods are counted, and a json blob is not a contract.
   *
   * Null on every transfer that predates this, which is truthful about them:
   * they were posted by the old unconditional path, and the backfill treats a
   * delivered transfer with a null here as already posted rather than pending.
   */
  inventory_posted_at: model.dateTime().nullable(),

  notes: model.text().nullable(),
  metadata: model.json().nullable(),
});

export default GoodsTransfer;
