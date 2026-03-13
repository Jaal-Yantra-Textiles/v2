import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import FeedbackModule from "../modules/feedback"

export default defineLink(
    { linkable: PartnerModule.linkable.partner, isList: true },
    { linkable: FeedbackModule.linkable.feedback, isList: true }
)
