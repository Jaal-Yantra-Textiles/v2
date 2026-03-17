import { model } from "@medusajs/framework/utils"
import PartnerPlan from "./partner-plan"
import { SubscriptionStatus } from "../types"

const PartnerSubscription = model.define("partner_subscription", {
  id: model.id().primaryKey(),
  partner_id: model.text(),
  status: model.enum(SubscriptionStatus).default(SubscriptionStatus.ACTIVE),
  current_period_start: model.dateTime(),
  current_period_end: model.dateTime().nullable(),
  canceled_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
  plan: model.belongsTo(() => PartnerPlan, {
    mappedBy: "subscriptions",
  }),
})

export default PartnerSubscription
