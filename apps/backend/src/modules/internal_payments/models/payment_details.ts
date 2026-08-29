import { model } from "@medusajs/framework/utils";

const PaymentDetail = model.define("internal_payment_details", {
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
  /**
   * The method approval falls back to when the reviewer names none.
   *
   * Before this existed, `createPaymentOnApprovalStep` took `methods[0]` —
   * whichever row the link query happened to return first. A partner with two
   * bank accounts was paid to an arbitrary one, silently.
   */
  is_default: model.boolean().default(false),
  metadata: model.json().nullable(),
});

export default PaymentDetail;
