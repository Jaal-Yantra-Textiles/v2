import { model } from "@medusajs/framework/utils";

const Line_fulfillment = model.define("line_fulfillment", {
  id: model.id().primaryKey(),
  // float, not number: deliveries are in raw-material units (kg) and must
  // accept decimals — the integer column silently rounded 1.5 → 2 (#342)
  quantity_delta: model.float(),
  event_type: model.enum(["sent","shipped","received","adjust","correction"]),
  transaction_id: model.text(),
  notes: model.text().nullable(),
  metadata: model.json(),
});

export default Line_fulfillment;
