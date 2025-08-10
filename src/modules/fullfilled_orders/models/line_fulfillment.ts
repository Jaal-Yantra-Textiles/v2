import { model } from "@medusajs/framework/utils";

const Line_fulfillment = model.define("line_fulfillment", {
  id: model.id().primaryKey(),
  quantity_delta: model.number(),
  event_type: model.enum(["sent","shipped","received","adjust","correction"]),
  transaction_id: model.text(),
  notes: model.text(),
  metadata: model.json(),
});

export default Line_fulfillment;
