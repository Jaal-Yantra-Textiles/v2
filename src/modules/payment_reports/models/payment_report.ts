import { model } from "@medusajs/framework/utils";

const PaymentReport = model.define("payment_report", {
  id: model.id().primaryKey(),
  name: model.text().nullable(),
  period_start: model.dateTime(),
  period_end: model.dateTime(),
  // "all" = across all entities; "partner" / "person" = scoped to one entity
  entity_type: model.enum(["all", "partner", "person"]).default("all"),
  entity_id: model.text().nullable(),
  total_amount: model.bigNumber(),
  payment_count: model.number(),
  // JSON breakdown blobs stored as-is
  by_status: model.json(),   // { Pending: n, Completed: n, ... }
  by_type: model.json(),     // { Bank: n, Cash: n, Digital_Wallet: n }
  by_month: model.json().nullable(), // [{ month: "2024-01", amount: n, count: n }]
  generated_at: model.dateTime(),
  filters: model.json().nullable(),
  metadata: model.json().nullable(),
});

export default PaymentReport;
