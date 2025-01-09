import { model } from "@medusajs/framework/utils";

const PaymentDetails = model.define("internal_payment_details", {
  id: model.id().primaryKey(),
  type: model.enum([
    "bank_account",
    "cash_account",
    "digital_wallet"
  ]),
  account_name: model.text(),
  account_number: model.text().nullable(),
  bank_name: model.text().nullable(),
  ifsc_code: model.text().nullable(),
  wallet_id: model.text().nullable(),
  metadata: model.json().nullable(),
});

export default PaymentDetails;
