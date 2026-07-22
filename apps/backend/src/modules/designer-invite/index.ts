import { Module } from "@medusajs/framework/utils"
import DesignerInviteService from "./service"

export const DESIGNER_INVITE_MODULE = "designerInvite"

export default Module(DESIGNER_INVITE_MODULE, {
  service: DesignerInviteService,
})
