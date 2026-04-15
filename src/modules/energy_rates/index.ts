import { Module } from "@medusajs/framework/utils"
import EnergyRateService from "./service"

export const ENERGY_RATES_MODULE = "energy_rates"

const EnergyRatesModule = Module(ENERGY_RATES_MODULE, {
  service: EnergyRateService,
})

export { EnergyRatesModule }

export default EnergyRatesModule
