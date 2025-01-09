import { model } from "@medusajs/framework/utils";
import PaymentDetails from "./payment_details";

const Payment = model.define("internal_payments", {
  id: model.id().primaryKey(),
  amount: model.bigNumber(),
  status: model.enum([
    "Pending",
    "Processing",
    "Completed",
    "Failed",
    "Cancelled"
  ]).default("Pending"),
  payment_type: model.enum([
    "Bank",
    "Cash",
    "Digital_Wallet"
  ]),
  payment_date: model.dateTime(),
  metadata: model.json().nullable(),
  
  // Relationship with PaymentDetails
  paid_to: model.belongsTo(() => PaymentDetails, { mappedBy: "payments" }),
});

export default Payment;
