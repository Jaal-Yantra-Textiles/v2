import { model } from "@medusajs/framework/utils"
import PartnerSubscription from "./partner-subscription"
import { PlanInterval } from "../types"

const PartnerPlan = model.define("partner_plan", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  slug: model.text().unique(),
  description: model.text().nullable(),
  price: model.float().default(0),
  currency_code: model.text().default("inr"),
  interval: model.enum(PlanInterval).default(PlanInterval.MONTHLY),
  features: model.json().nullable(),
  is_active: model.boolean().default(true),
  sort_order: model.number().default(0),
  metadata: model.json().nullable(),
  subscriptions: model.hasMany(() => PartnerSubscription, {
    mappedBy: "plan",
  }),
})

export default PartnerPlan
