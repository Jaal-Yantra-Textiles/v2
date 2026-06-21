import { model } from "@medusajs/framework/utils";
import Payment from "./payment";

/**
 * PaymentAttachment is the file↔payment link table for internal payments.
 *
 * Decision (#496): attachments live in a dedicated link table — NOT in
 * `internal_payments.metadata` — because Medusa rewrites the whole metadata
 * blob on every update, which would silently drop previously-attached file
 * refs. Each row references an uploaded file (file module id + url) and the
 * owning payment.
 */
const PaymentAttachment = model.define("internal_payment_attachment", {
  id: model.id().primaryKey(),
  // File module reference (from `sdk.admin.upload` / Modules.FILE)
  file_id: model.text(),
  url: model.text(),
  filename: model.text().nullable(),
  mime_type: model.text().nullable(),
  size: model.number().nullable(),
  metadata: model.json().nullable(),
  payment: model.belongsTo(() => Payment, { mappedBy: "attachments" }),
});

export default PaymentAttachment;
