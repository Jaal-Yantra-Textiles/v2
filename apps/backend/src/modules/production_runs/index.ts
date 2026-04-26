import { Module } from "@medusajs/framework/utils"
import ProductionRunService from "./service"

export const PRODUCTION_RUNS_MODULE = "production_runs"

const ProductionRunsModule = Module(PRODUCTION_RUNS_MODULE, {
  service: ProductionRunService,
})

export { ProductionRunsModule }
export default ProductionRunsModule
