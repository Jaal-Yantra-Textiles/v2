import { model } from "@medusajs/framework/utils"

// An investor inviting a friend / another investor into the portal. Onboarding
// stays invite-only (admin provisions the account), so a referral is a lead the
// team follows up on — not a self-serve signup. `access_level` records what the
// referrer wants the invitee to be able to do once onboarded.
const Referral = model.define("investor_referral", {
  id: model.id().primaryKey(),

  referrer_investor_id: model.text(),
  company_id: model.text().nullable(),

  name: model.text(),
  email: model.text(),
  note: model.text().nullable(),

  access_level: model.enum(["view_only", "investor"]).default("investor"),
  status: model.enum(["invited", "contacted", "joined", "declined"]).default("invited"),

  metadata: model.json().nullable(),
})

export default Referral
