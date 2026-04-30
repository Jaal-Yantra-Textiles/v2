import { model } from "@medusajs/framework/utils"
import PartnerSubscription from "./partner-subscription"
import { PaymentProvider, SubscriptionPaymentStatus } from "../types"

const SubscriptionPayment = model.define("subscription_payment", {
  id: model.id().primaryKey(),
  amount: model.float(),
  currency_code: model.text().default("inr"),
  status: model
    .enum(SubscriptionPaymentStatus)
    .default(SubscriptionPaymentStatus.PENDING),
  provider: model.enum(PaymentProvider).default(PaymentProvider.MANUAL),
  provider_reference_id: model.text().nullable(),
  provider_data: model.json().nullable(),
  period_start: model.dateTime(),
  period_end: model.dateTime(),
  paid_at: model.dateTime().nullable(),
  failed_at: model.dateTime().nullable(),
  failure_reason: model.text().nullable(),
  metadata: model.json().nullable(),
  // Nullable: a payment row is created BEFORE the subscription exists
  // (PayU pre-payment intent). The PayU success callback then creates
  // the subscription and links it back. Failure-only audit rows also
  // stay orphan since no subscription was ever activated.
  subscription: model.belongsTo(() => PartnerSubscription, {
    mappedBy: "payments",
  }).nullable(),
})

export default SubscriptionPayment
