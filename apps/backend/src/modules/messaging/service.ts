import { MedusaService } from "@medusajs/framework/utils"
import Conversation from "./models/conversation"
import Message from "./models/message"

class MessagingService extends MedusaService({
    MessagingConversation: Conversation,
    MessagingMessage: Message,
}) {
    constructor() {
        super(...arguments)
    }
}

export default MessagingService
