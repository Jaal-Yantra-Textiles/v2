import { model } from "@medusajs/framework/utils"
import PartnerPlan from "./partner-plan"
import SubscriptionPayment from "./subscription-payment"
import { PaymentProvider, SubscriptionStatus } from "../types"

const PartnerSubscription = model.define("partner_subscription", {
  id: model.id().primaryKey(),
  partner_id: model.text(),
  status: model.enum(SubscriptionStatus).default(SubscriptionStatus.ACTIVE),
  payment_provider: model.enum(PaymentProvider).default(PaymentProvider.MANUAL),
  current_period_start: model.dateTime(),
  current_period_end: model.dateTime().nullable(),
  canceled_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
  plan: model.belongsTo(() => PartnerPlan, {
    mappedBy: "subscriptions",
  }),
  payments: model.hasMany(() => SubscriptionPayment, {
    mappedBy: "subscription",
  }),
})

export default PartnerSubscription
