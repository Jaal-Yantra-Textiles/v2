import { Module } from "@medusajs/framework/utils"
import AiVTwoService from "./service"

export const AI_VTWO_MODULE = "ai_vtwo"

const AiVTwoModule = Module(AI_VTWO_MODULE, {
  service: AiVTwoService,
})
export { AiVTwoModule }
export default AiVTwoModule
