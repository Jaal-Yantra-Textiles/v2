import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import MessagingModule from "../modules/messaging"

export default defineLink(
    { linkable: PartnerModule.linkable.partner, isList: true, filterable: ["id", "name", "handle", "status"] },
    { linkable: MessagingModule.linkable.messagingConversation, isList: true, filterable: ["id", "status", "phone_number"] }
)
