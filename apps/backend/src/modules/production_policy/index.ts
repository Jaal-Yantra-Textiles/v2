import { Module } from "@medusajs/framework/utils"
import ProductionPolicyService from "./service"

export const PRODUCTION_POLICY_MODULE = "production_policy"

const ProductionPolicyModule = Module(PRODUCTION_POLICY_MODULE, {
  service: ProductionPolicyService,
})

export { ProductionPolicyModule }
export default ProductionPolicyModule
