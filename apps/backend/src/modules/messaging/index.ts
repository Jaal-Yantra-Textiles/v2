import { Module } from "@medusajs/framework/utils"
import MessagingService from "./service"

export const MESSAGING_MODULE = "messaging"

const MessagingModule = Module(MESSAGING_MODULE, {
    service: MessagingService,
})

export { MessagingModule }
export default MessagingModule
