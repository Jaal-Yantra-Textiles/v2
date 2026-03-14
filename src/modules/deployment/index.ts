import { Module } from "@medusajs/framework/utils"
import DeploymentService from "./service"

export const DEPLOYMENT_MODULE = "deployment"

const DeploymentModule = Module(DEPLOYMENT_MODULE, {
  service: DeploymentService,
})

export { DeploymentModule }
export default DeploymentModule
