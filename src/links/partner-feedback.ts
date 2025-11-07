import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import FeedbackModule from "../modules/feedback"

export default defineLink(
    { linkable: PartnerModule.linkable.partner, isList: true, filterable: ["id", "name", "handle", "status"] },
    { linkable: FeedbackModule.linkable.feedback, isList: true, filterable: ["id", "rating", "status", "submitted_at"] }
)
