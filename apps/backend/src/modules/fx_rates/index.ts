import { Module } from "@medusajs/framework/utils"
import FxRatesService from "./service"

export const FX_RATES_MODULE = "fx_rates"

export default Module(FX_RATES_MODULE, {
  service: FxRatesService,
})
